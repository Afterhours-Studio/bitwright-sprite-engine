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

"""Tests for the parent watchdog.

A sidecar that outlives its parent keeps the GPU memory it had loaded, and the
next launch of the application fails to allocate for a reason the user cannot
see.
"""

from __future__ import annotations

import os
import threading

from bitwright_engine.api.server import parse_args
from bitwright_engine.utils.watchdog import (
    install_parent_death_signal,
    pid_exists,
    watch_parent,
)


def test_this_process_exists() -> None:
    assert pid_exists(os.getpid())


def test_an_unused_pid_does_not_exist() -> None:
    # Process ids are recycled, so this asserts on a value that cannot be one.
    assert not pid_exists(-1)


def test_the_callback_fires_once_the_parent_is_gone() -> None:
    fired = threading.Event()
    alive = [True, True, False]

    def exists(_pid: int) -> bool:
        return alive.pop(0) if alive else False

    thread = watch_parent(4242, fired.set, interval_s=0.01, exists=exists)

    assert fired.wait(timeout=5), "the watchdog did not react to the parent exiting"
    thread.join(timeout=5)
    assert not thread.is_alive()


def test_the_callback_does_not_fire_while_the_parent_lives() -> None:
    fired = threading.Event()
    stop = threading.Event()

    thread = watch_parent(
        os.getpid(),
        fired.set,
        interval_s=0.01,
        exists=lambda _pid: True,
        stop=stop,
    )

    assert not fired.wait(timeout=0.2)

    stop.set()
    thread.join(timeout=5)
    assert not thread.is_alive()


def test_stopping_the_watch_ends_the_thread_without_firing() -> None:
    fired = threading.Event()
    stop = threading.Event()

    thread = watch_parent(4242, fired.set, interval_s=5.0, exists=lambda _pid: False, stop=stop)
    stop.set()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert not fired.is_set()


def test_the_watcher_is_a_daemon() -> None:
    # A non-daemon watcher would keep the interpreter alive after the server
    # stopped, which is the orphan this module exists to prevent.
    stop = threading.Event()
    thread = watch_parent(os.getpid(), lambda: None, interval_s=5.0, stop=stop)

    assert thread.daemon
    stop.set()
    thread.join(timeout=5)


def test_installing_the_death_signal_never_raises() -> None:
    # Linux only. Everywhere else it reports False rather than failing, because
    # the poll loop is the mechanism that works on every platform.
    assert isinstance(install_parent_death_signal(), bool)


def test_the_parent_pid_argument_is_optional() -> None:
    assert parse_args([]).parent_pid is None
    assert parse_args(["--parent-pid", "1234"]).parent_pid == 1234
