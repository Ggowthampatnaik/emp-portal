"""Send a test message, and say plainly what the mail settings actually are.

``python manage.py mailtest someone@example.com``

Written because "email is not working" is almost never the mail *code*: it is
the console backend quietly eating the message, a host that was only ever
configured for production, or credentials the relay rejects. This prints the
configuration it is about to use before it uses it, so the answer is on screen
either way.
"""

from django.conf import settings
from django.core.mail import get_connection, send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send a test email and report the delivery settings in force."

    def add_arguments(self, parser):
        parser.add_argument("recipient", help="Address to send the test message to.")

    def handle(self, *args, **options):
        recipient = options["recipient"]
        backend = settings.EMAIL_BACKEND
        console = backend.endswith("console.EmailBackend")

        self.stdout.write("Mail configuration in force:")
        for label, value in (
            ("EMAIL_BACKEND", backend),
            ("EMAIL_HOST", settings.EMAIL_HOST or "(not set)"),
            ("EMAIL_PORT", settings.EMAIL_PORT),
            ("EMAIL_HOST_USER", settings.EMAIL_HOST_USER or "(not set)"),
            ("EMAIL_HOST_PASSWORD", "(set)" if settings.EMAIL_HOST_PASSWORD else "(not set)"),
            ("EMAIL_USE_TLS", settings.EMAIL_USE_TLS),
            ("EMAIL_USE_SSL", settings.EMAIL_USE_SSL),
            ("EMAIL_TIMEOUT", settings.EMAIL_TIMEOUT),
            ("DEFAULT_FROM_EMAIL", settings.DEFAULT_FROM_EMAIL),
        ):
            self.stdout.write(f"  {label:22} {value}")

        if console:
            self.stdout.write(
                self.style.WARNING(
                    "\nThe console backend is active, so nothing will leave this "
                    "machine - the message is printed below instead. Set EMAIL_HOST "
                    "in backend/.env to send for real."
                )
            )

        self.stdout.write(f"\nSending to {recipient} ...")
        try:
            # An explicit connection surfaces a refused or unauthenticated
            # relay here, rather than as a generic failure inside send_mail.
            connection = get_connection(fail_silently=False)
            connection.open()
            sent = send_mail(
                subject="[Employee Portal] Test message",
                message=(
                    "This is a test from the Trigyan Employee Portal.\n\n"
                    "If you are reading it in your inbox, password resets and "
                    "notification emails will reach people too.\n\n"
                    "--\nTrigyan Employee Portal\nEmpowering Ideas\n"
                ),
                from_email=None,  # DEFAULT_FROM_EMAIL
                recipient_list=[recipient],
                fail_silently=False,
                connection=connection,
            )
            connection.close()
        except Exception as exc:
            hint = {
                "getaddrinfo": "EMAIL_HOST does not resolve - check it for typos",
                "authentication": "the username or password was rejected by the relay",
                "certificate": "TLS negotiation failed - check EMAIL_USE_TLS vs EMAIL_USE_SSL",
                "timed out": "the host did not answer - check EMAIL_HOST and EMAIL_PORT",
                "refused": "the host refused the connection - check EMAIL_HOST and EMAIL_PORT",
            }
            text = str(exc).lower()
            detail = next((why for word, why in hint.items() if word in text), None)
            message = f"{type(exc).__name__}: {exc}"
            if detail:
                message += f"\nLikely cause: {detail}."
            raise CommandError(message) from exc

        if not sent:
            raise CommandError("The backend accepted the call but sent 0 messages.")

        self.stdout.write(
            self.style.SUCCESS(
                "Printed to the console above." if console else f"Sent to {recipient}."
            )
        )
