"""
Keep a Mait's login account carrying the Mait's name.

``User.full_name`` is copied from ``Mait.name`` when an admin activates the account
(``apps.accounts.admin_serializers``), and until now that was the only time the two were ever
put in step. Every later rename — a corrected spelling in the assignment sheet, an edit on the
Maits screen, a fix in Django admin — moved one and left the other.

The two names are not interchangeable in the UI, which is what makes the drift visible rather
than merely untidy. Screens naming the *Mait* read ``Mait.name``; screens naming whoever
performed an action read ``actor.full_name``, because an actor may be an admin with no Mait
record at all. The AI event detail screen shows both, so a renamed Mait appeared there as two
different people — the header attributing the event to one name and every line of the audit
trail beneath it to another.

Denormalised on purpose, not fixed by dropping the copy: ``full_name`` belongs to every user,
most of whom are not Maits, and the audit trail has to keep naming an actor whose Mait record
is later retired.
"""

from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Mait


@receiver(post_save, sender=Mait, dispatch_uid="masterdata.sync_mait_name_to_user")
def sync_mait_name_to_user(sender, instance: Mait, update_fields=None, **kwargs) -> None:
    """
    Push a changed Mait name onto the linked login account.

    Skipped when the save did not touch the name, so the ordinary write path — assigning an
    MPP, updating a mobile number — costs nothing extra. ``update_fields`` is ``None`` for a
    plain ``save()``, which has to be treated as "might have", and it is what the Django admin
    sends.

    A blank name is not propagated. The upload treats an empty cell as "no opinion" rather
    than as an instruction to clear the field, and an account with no name on it cannot be
    attributed to anybody.
    """
    if update_fields is not None and "name" not in update_fields:
        return

    user = instance.user
    if user is None or not instance.name or user.full_name == instance.name:
        return

    user.full_name = instance.name
    user.save(update_fields=["full_name", "updated_at"])
