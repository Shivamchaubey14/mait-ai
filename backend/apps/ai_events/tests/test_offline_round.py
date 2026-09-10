"""
A round worked with no signal, replayed over real HTTP (SRS §6.9, ADR 0003).

The other suites test the pieces. This one walks the sequence a handset actually sends after a
morning in a village with no bars, in the order `api/sync` sends it, and then sends the whole
thing **a second time** — because that is the case the offline queue cannot avoid and cannot
detect: the requests went through and the responses were lost somewhere between the tower and
the phone.

What has to be true at the end is arithmetic. One cow on the farmer's roster, not two. One
insemination, not two. One straw off the flask, not two. If any of those doubles, a farmer is
charged twice for one service and the flask disagrees with the ledger at the end of the month —
and neither is recoverable from the record afterwards.
"""

from __future__ import annotations

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.ai_events.models import AIEvent
from apps.animals.models import Animal
from apps.inventory.services import available_straw_count

pytestmark = pytest.mark.django_db

BASE = "/api/v1"

# The keys the handset minted before any of this was sent — one for the cow, one for the
# capture. Both survive the app being closed, which is the whole point of minting them early.
COW_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CAPTURE_KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def auth(user):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


def a_photo():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), (90, 140, 110)).save(buffer, format="JPEG")
    return SimpleUploadedFile("proof.jpg", buffer.getvalue(), content_type="image/jpeg")


class TestAWholeRoundReplayed:
    """
    Everything the handset queued, sent twice.

    The second pass is not a retry the app chose to make — it is what the queue does when it
    has no way to know the first pass landed. Every request carries the same key it carried the
    first time, which is what makes that safe.
    """

    def drain(self, client, mpp, member, straw):
        """One pass of the queue, in the order `api/sync` sends it."""
        cow = client.post(
            f"{BASE}/animals/",
            {
                "client_uuid": COW_KEY,
                "member_code": member.member_code,
                "animal_type": "COW",
            },
            format="json",
        )
        assert cow.status_code in (200, 201), cow.json()
        cow_id = cow.json()["id"]

        # Her portrait, which the queue sends as its own job.
        portrait = client.patch(
            f"{BASE}/animals/{cow_id}/photo/", {"photo": a_photo()}, format="multipart"
        )
        assert portrait.status_code == 200, portrait.json()

        # The capture, against the id the registration just came back with. On the second pass
        # that id is the same one, which is the only reason this points at one animal.
        event = client.post(
            f"{BASE}/ai-events/",
            {
                "client_uuid": CAPTURE_KEY,
                "mpp_code": mpp.mpp_code,
                "member_code": member.member_code,
                "animal_id": cow_id,
                "straw_unique_no": straw.unique_straw_no,
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=CAPTURE_KEY,
        )
        assert event.status_code in (200, 201), event.json()
        event_id = event.json()["id"]

        proof = client.patch(
            f"{BASE}/ai-events/{event_id}/photo/",
            {"photo": a_photo(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=CAPTURE_KEY,
        )
        assert proof.status_code == 200, proof.json()

        return cow_id, event_id

    def test_the_second_pass_changes_nothing(self, mait, mpp, member, stocked_mait):
        client = auth(mait.user)
        straw = stocked_mait(1)[0]
        before = available_straw_count(mait)

        first_cow, first_event = self.drain(client, mpp, member, straw)
        second_cow, second_event = self.drain(client, mpp, member, straw)

        # The same rows, not new ones.
        assert second_cow == first_cow
        assert second_event == first_event

        # And the counts a dispute would be settled from.
        assert Animal.objects.filter(client_uuid=COW_KEY).count() == 1
        assert AIEvent.objects.filter(client_uuid=CAPTURE_KEY).count() == 1
        assert AIEvent.objects.get(client_uuid=CAPTURE_KEY).status == AIEvent.Status.PHOTO_CAPTURED

        # Nothing is deducted before completion, on either pass — an abandoned capture costs
        # the Mait nothing, because no insemination has been recorded as finished.
        assert available_straw_count(mait) == before

    def test_the_photo_replay_is_not_an_error_the_queue_would_retry_forever(
        self, mait, mpp, member, stocked_mait
    ):
        """
        The specific failure this sequence used to hit.

        A replayed photo asked the state machine to leave `photo_captured`, which is not a
        transition it has, so the answer was a `409` — and the app treats a 409 as worth
        retrying. The job stayed in the queue failing a request that could never succeed, and
        because the drain used to stop at the first failure, every capture behind it stopped
        too. One lost response held up a day.
        """
        client = auth(mait.user)
        straw = stocked_mait(1)[0]
        _cow, event_id = self.drain(client, mpp, member, straw)

        replay = client.patch(
            f"{BASE}/ai-events/{event_id}/photo/",
            {"photo": a_photo(), "gps_lat": "28.3670000", "gps_lng": "79.4304000"},
            format="multipart",
            HTTP_IDEMPOTENCY_KEY=CAPTURE_KEY,
        )

        assert replay.status_code == 200, replay.json()
