"""The Complete Profile gate (F18, decision D11).

A new employee signs in with temporary credentials, is forced to change the
password, and then must fill in their profile before the portal opens. The plan
calls this a **hard** gate, which means it cannot only be a redirect in the SPA:
anyone can open dev tools and call the API directly.

It is enforced in the authentication layer rather than as a DRF permission,
because nearly every viewset in this codebase declares its own
``permission_classes`` — and a declared list *replaces* the default one, so a
default permission would silently apply to almost nothing. Authentication runs
for every request whatever the view says, which is the property a hard gate
needs.

Read it as a limit on what the session is good for: until the profile is
complete, the credential opens the wizard and nothing else.
"""

#: Paths (after the /api/v1 prefix) reachable while the profile is incomplete.
#: Prefix matches, so nested routes under these are allowed too.
ALLOWED_PREFIXES = (
    "auth/",  # me, logout, password change, token refresh
    "employees/me",  # the employee's own record
    "notifications/",  # what the wizard itself raises
    "departments/",  # reference data the form shows
    "designations/",
    "skills/",  # the optional skills step
)

#: Endpoints on the caller's *own* employee record that the wizard writes to.
OWN_RECORD_SUFFIXES = (
    "complete-profile/",
    "profile-draft/",
    "photo/",
    "documents/",
    "skills/",
    "experience/",
)

MESSAGE = "Complete your profile before using the portal. It only has to be done once."


def api_path(request) -> str:
    """The request path with the API prefix removed, e.g. ``employees/me/``."""
    path = request.path_info.lstrip("/")
    for prefix in ("api/v1/", "api/"):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path


#: While a temporary password is in force, the session opens the
#: change-password screen and nothing else. Every route under auth/ is safe to
#: leave open: me, logout, the change itself, and token refresh.
PASSWORD_CHANGE_PREFIXES = ("auth/",)

PASSWORD_MESSAGE = "Change your temporary password before using the portal."


def must_change_password_first(user, request) -> bool:
    """True when this request should be refused pending a password change.

    The SPA already sends the person to the change-password screen; this is
    what stops somebody who skips the SPA from working indefinitely on a
    credential that arrived in plain text by email.
    """
    if not getattr(user, "must_change_password", False):
        return False
    return not api_path(request).startswith(PASSWORD_CHANGE_PREFIXES)


def may_proceed(user, request) -> bool:
    """False when this request should be refused pending profile completion."""
    profile = getattr(user, "employee_profile", None)
    if profile is None or profile.profile_completed:
        # No employment record means no profile to complete - a bare
        # administrator account is not held up by this.
        return True

    path = api_path(request)
    if path.startswith(ALLOWED_PREFIXES):
        return True

    # The wizard writes to the caller's own record: /employees/<their id>/...
    if path.startswith("employees/") and path.endswith(OWN_RECORD_SUFFIXES):
        wanted = path.split("/")[1]
        return wanted.isdigit() and int(wanted) == profile.pk

    return False
