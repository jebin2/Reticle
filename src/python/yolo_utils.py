"""
Shared utilities for YOLOStudio Python scripts.
"""

import os
import sys


def suppress_fd1():
    """
    Context manager that redirects both sys.stdout and the underlying OS file
    descriptor 1 to /dev/null. Needed because ultralytics C extensions write
    directly to fd 1, bypassing Python's sys.stdout.
    """
    class _Ctx:
        def __enter__(self):
            sys.stdout.flush()
            self._fd_save   = os.dup(1)
            devnull         = os.open(os.devnull, os.O_WRONLY)
            os.dup2(devnull, 1)
            os.close(devnull)
            self._old_stdout = sys.stdout
            sys.stdout       = open(os.devnull, "w")
            return self
        def __exit__(self, *_):
            sys.stdout.close()
            sys.stdout = self._old_stdout
            os.dup2(self._fd_save, 1)
            os.close(self._fd_save)
    return _Ctx()
