"""Keeps leave entitlement in step with the profile it depends on.

`LeaveType.restricted_to_gender` decides who a policy applies to, and that is
checked when a balance is opened and again when balances are listed. Neither
covers the case where the *profile* changes afterwards: correct somebody's
gender and the maternity balance opened under the old value stays in the table.

This closes that gap at the one moment it can arise.
"""

import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from apps.employees.models import Employee
from apps.leave_management.services import revoke_ineligible_balances

logger = logging.getLogger(__name__)

#: Gender before the save, stashed between `pre_save` and `post_save` so the
#: handler can tell an actual change from any other edit to the record.
_PREVIOUS_GENDER: dict[int, str] = {}


@receiver(pre_save, sender=Employee, dispatch_uid="leave_remember_gender")
def remember_gender(sender, instance: Employee, **kwargs) -> None:
    if not instance.pk:
        return
    previous = Employee.objects.filter(pk=instance.pk).values_list("gender", flat=True).first()
    if previous is not None:
        _PREVIOUS_GENDER[instance.pk] = previous


@receiver(post_save, sender=Employee, dispatch_uid="leave_revoke_on_gender_change")
def revoke_on_gender_change(sender, instance: Employee, created: bool, **kwargs) -> None:
    previous = _PREVIOUS_GENDER.pop(instance.pk, None)
    if created or previous is None or previous == instance.gender:
        return

    removed = revoke_ineligible_balances(instance)
    if removed:
        logger.info(
            "Gender changed for %s (%r -> %r): closed %d balance(s)",
            instance.employee_code,
            previous,
            instance.gender,
            removed,
        )
