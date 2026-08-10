"""
Handing work to the background, in dev as well as in production.

``CELERY_TASK_ALWAYS_EAGER`` is how this project runs without a broker — the no-Docker path in
``scripts/dev-start.ps1``, which is how the work is actually done. But eager does not mean
"run it in the background without Celery"; it means *run it inline, right now*. So
``process_master_upload.delay(id)`` returned only after the whole 105,000-row Member import had
finished, several minutes later, from inside the POST that was supposed to answer 202 and let
the page start polling.

Everything downstream then looked broken in a way that pointed at the wrong thing. The progress
card is painted from the poll, and the first poll only happens once the POST resolves — by
which time the import is over and the card is hidden again. An operator saw no progress at all
unless they reloaded the page mid-import, which is when the *page-load* path found the running
upload and started polling it. Three files at once was worse: three requests each holding a
worker thread for minutes.

``run_in_background`` keeps one promise in both modes — this call returns before the work does.
"""

from __future__ import annotations

import logging
import threading

from django.conf import settings
from django.db import close_old_connections

logger = logging.getLogger(__name__)


def run_in_background(task, *args, **kwargs) -> None:
    """
    Queue a Celery task, or run it on a thread when there is no broker to queue it to.

    The thread is only ever taken in eager mode, which is a development setting — production
    refuses to boot with it on. There it is a real worker, and this is one line of indirection.
    """
    if not getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        task.delay(*args, **kwargs)
        return

    # Tests set this. They need the work finished before the assertion on the next line, and a
    # thread would have them racing the importer.
    if getattr(settings, "BACKGROUND_TASKS_INLINE", False):
        task(*args, **kwargs)
        return

    def run() -> None:
        # A thread gets its own connection, and Django will not clean up one it did not open
        # per-request. Closed on both sides so a long import does not leave a MySQL connection
        # behind every time a file is uploaded.
        close_old_connections()
        try:
            task(*args, **kwargs)
        except Exception:
            # The task records its own failure on the upload row, which is what the operator
            # reads. This is for the terminal, so a crash in eager mode is not silent.
            logger.exception("Background task %s failed", getattr(task, "name", task))
        finally:
            close_old_connections()

    # Daemon: a dev server being stopped should not wait on an import nobody is watching.
    threading.Thread(target=run, name="eager-task", daemon=True).start()
