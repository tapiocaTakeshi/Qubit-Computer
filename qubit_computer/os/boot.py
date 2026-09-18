"""QubitOS boot loader / command-line entry point.

    qubitos                      interactive shell
    qubitos -c "run bell; ent last"
    qubitos script.qsh           run a shell script
    qubitos --fs ~/.qubitos.json persist the virtual filesystem
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Optional

from .kernel import OS_NAME, OS_VERSION, Kernel
from .shell import Shell

BANNER = r"""
   ____        _     _ _    ___  ____
  / __ \      | |   (_) |  / _ \/ ___|
 | |  | |_   _| |__  _| |_| | | \___ \
 | |__| | |_| | '_ \| | __| | | |___) |
  \___\_\\__,_|_.__/|_|\__|\___/|____/   {name} {version}
  operating system for the APQB quantum computer
  |ψ(θ)> = cosθ|0> + sinθ|1>   r = cos2θ   η = |sin2θ|   r² + η² = 1
"""


def boot(num_qubits: int = 16, fs_path: Optional[str] = None, seed: Optional[int] = None,
         theta: float = 0.2, quiet: bool = False, backend: str = "cpu", out=print) -> Kernel:
    kernel = Kernel(num_qubits=num_qubits, fs_path=fs_path, seed=seed, theta=theta, backend=backend)
    if not quiet:
        out(BANNER.format(name=OS_NAME, version=OS_VERSION))
        for line in kernel.sys_dmesg():
            out(line)
    return kernel


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="qubitos", description=f"{OS_NAME}: an OS for the APQB quantum computer")
    parser.add_argument("script", nargs="?", help="a .qsh script on the host filesystem")
    parser.add_argument("-c", "--command", help="run command(s) separated by ';' and exit")
    parser.add_argument("-q", "--qubits", type=int, default=16, help="physical qubits (default 16)")
    parser.add_argument("--fs", help="persist the virtual filesystem to this JSON file")
    parser.add_argument("--seed", type=int, help="seed for measurements and the scheduler")
    parser.add_argument("--theta", type=float, default=0.2, help="system APQB angle (scheduler exploration)")
    parser.add_argument("--backend", default="cpu", choices=["cpu", "gpu", "qnpu"],
                        help="compute backend: cpu (default) | gpu (numpy, if installed) | qnpu (future hardware)")
    parser.add_argument("--quiet", action="store_true", help="suppress the boot banner")
    args = parser.parse_args(argv)

    kernel = boot(num_qubits=args.qubits, fs_path=args.fs, seed=args.seed, theta=args.theta,
                  backend=args.backend, quiet=args.quiet or bool(args.command))
    shell = Shell(kernel)
    if args.command:
        status = shell.execute_line(args.command)
        kernel.shutdown()
        return status
    if args.script:
        with open(args.script, "r", encoding="utf-8") as fh:
            status = shell.run_script(fh.read())
        kernel.shutdown()
        return status
    shell.repl()
    if shell.running:
        kernel.shutdown()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
