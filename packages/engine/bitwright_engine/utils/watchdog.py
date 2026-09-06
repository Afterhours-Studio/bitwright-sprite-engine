# Bitwright - Sprite Engine
# Copyright (C) 2026 Afterhours Studio
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Exit when the process that spawned us is gone.

A sidecar that outlives its parent is not merely untidy. It holds the GPU
memory it had loaded, so the next launch of the application fails to allocate,
and the user is told they are out of memory by an application that has only
just started. The orphan is invisible to them.

The shell passes its own process id on the command line, and this module
watches it. Polling is the primary mechanism, because it works the same way on
Windows, macOS, and Linux. On Linux a kernel death signal is installed as well,
which reacts immediately rather than within one poll interval.
"""

from __future__ import annotations

import ctypes
import os
import platform
import threading
from collections.abc import Callable

from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

POLL_INTERVAL_S = 2.0
"""How often the parent is checked, in seconds."""

# From <linux/prctl.h>. Asks the kernel to signal this process when its parent
# dies, which is immediate rather than up to one poll interval late.
PR_SET_PDEATHSIG = 1
SIGTERM = 15


def pid_exists(pid: int) -> bool:
    """Report whether a process with this id is running.

    Args:
        pid: The process id to check.

    Returns:
        True when the process exists.
    """
    try:
        import psutil
    except ImportError:  # pragma: no cover - psutil is a hard dependency
        logger.warning("psutil is unavailable, so the parent cannot be watched")
        return True

    return bool(psutil.pid_exists(pid))


def install_parent_death_signal() -> bool:
    """Ask the kernel to terminate this process when its parent dies.

    Linux only. Everywhere else this is a no-op and the poll loop is the whole
    mechanism, which is why the failure is reported rather than raised.

    Returns:
        True when the signal was installed.
    """
    # platform.system() rather than sys.platform, because a type checker folds
    # sys.platform to the platform it is running on and then treats the rest of
    # this function as unreachable.
    if platform.system() != "Linux":
        return False

    try:
        libc = ctypes.CDLL("libc.so.6", use_errno=True)
        result = libc.prctl(PR_SET_PDEATHSIG, SIGTERM, 0, 0, 0)
    except (OSError, AttributeError) as error:
        logger.debug("could not install a parent death signal: %s", error)
        return False

    if result != 0:
        logger.debug("prctl(PR_SET_PDEATHSIG) returned %d", result)
        return False

    logger.debug("installed a parent death signal")
    return True


def watch_parent(
    parent_pid: int,
    on_parent_exit: Callable[[], None],
    *,
    interval_s: float = POLL_INTERVAL_S,
    exists: Callable[[int], bool] = pid_exists,
    stop: threading.Event | None = None,
) -> threading.Thread:
    """Poll a parent process, and call back once it is gone.

    The thread is a daemon, so it never keeps the interpreter alive on its own.

    Args:
        parent_pid: Process id to watch.
        on_parent_exit: Called once, when the parent is no longer running.
        interval_s: Seconds between checks.
        exists: Process existence check. Injectable for tests.
        stop: Set this event to end the watch without calling back.

    Returns:
        The started watcher thread.
    """
    stop_event = stop if stop is not None else threading.Event()

    def run() -> None:
        logger.info("watching parent process %d", parent_pid)
        while not stop_event.wait(interval_s):
            if exists(parent_pid):
                continue

            logger.warning("parent process %d is gone, shutting down", parent_pid)
            on_parent_exit()
            return

    thread = threading.Thread(target=run, name="parent-watchdog", daemon=True)
    thread.start()
    return thread


def exit_now() -> None:
    """Leave the process immediately.

    The fallback callback, for when no server is attached to stop gracefully.

    ``sys.exit`` raises ``SystemExit`` in the calling thread, and the watcher is
    not the main thread, so it would end the watcher and leave the process
    running. ``os._exit`` is what actually leaves. The parent is already gone,
    so there is no client left to serve and nothing to drain.
    """
    os._exit(0)
