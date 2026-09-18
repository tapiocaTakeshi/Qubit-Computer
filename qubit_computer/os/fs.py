"""QubitFS -- a small hierarchical virtual filesystem for QubitOS.

Directories are dicts, files are strings (text) -- JSON circuits, QBNN
weights, run results and shell scripts all live here.  The tree can be
persisted to a single JSON file on the host so the OS keeps state between
boots.
"""

from __future__ import annotations

import json
import os
import posixpath
import time
from typing import Any, Dict, List, Optional, Tuple

__all__ = ["QubitFS", "FSError"]


class FSError(Exception):
    pass


class QubitFS:
    def __init__(self, backing_file: Optional[str] = None):
        self.backing_file = backing_file
        self.root: Dict[str, Any] = {}
        self.cwd = "/"
        if backing_file and os.path.exists(backing_file):
            with open(backing_file, "r", encoding="utf-8") as fh:
                self.root = json.load(fh)
        else:
            self._populate_defaults()

    # ------------------------------------------------------------ paths
    def resolve(self, path: str) -> str:
        if not path:
            return self.cwd
        if not path.startswith("/"):
            path = posixpath.join(self.cwd, path)
        norm = posixpath.normpath(path)
        return "/" if norm in ("", ".") else norm

    def _walk(self, path: str, create_dirs: bool = False) -> Tuple[Dict[str, Any], str]:
        """Return (parent_dir, basename) for ``path``."""
        full = self.resolve(path)
        if full == "/":
            return self.root, ""
        parts = [p for p in full.split("/") if p]
        node = self.root
        for part in parts[:-1]:
            if part not in node:
                if not create_dirs:
                    raise FSError(f"no such directory: {part}")
                node[part] = {}
            node = node[part]
            if not isinstance(node, dict):
                raise FSError(f"not a directory: {part}")
        return node, parts[-1]

    def _node(self, path: str) -> Any:
        full = self.resolve(path)
        if full == "/":
            return self.root
        parent, name = self._walk(full)
        if name not in parent:
            raise FSError(f"no such file or directory: {full}")
        return parent[name]

    # -------------------------------------------------------- operations
    def exists(self, path: str) -> bool:
        try:
            self._node(path)
            return True
        except FSError:
            return False

    def is_dir(self, path: str) -> bool:
        try:
            return isinstance(self._node(path), dict)
        except FSError:
            return False

    def ls(self, path: str = "") -> List[str]:
        node = self._node(path or self.cwd)
        if not isinstance(node, dict):
            return [posixpath.basename(self.resolve(path))]
        out = []
        for name in sorted(node):
            out.append(name + "/" if isinstance(node[name], dict) else name)
        return out

    def mkdir(self, path: str, parents: bool = True) -> None:
        parent, name = self._walk(path, create_dirs=parents)
        if not name:
            return
        if name in parent:
            if isinstance(parent[name], dict):
                return
            raise FSError(f"file exists: {path}")
        parent[name] = {}

    def write(self, path: str, text: str, append: bool = False) -> None:
        parent, name = self._walk(path, create_dirs=True)
        if not name:
            raise FSError("cannot write to /")
        if name in parent and isinstance(parent[name], dict):
            raise FSError(f"is a directory: {path}")
        if append and name in parent:
            parent[name] = parent[name] + text
        else:
            parent[name] = text

    def read(self, path: str) -> str:
        node = self._node(path)
        if isinstance(node, dict):
            raise FSError(f"is a directory: {path}")
        return node

    def read_json(self, path: str) -> Any:
        return json.loads(self.read(path))

    def write_json(self, path: str, obj: Any) -> None:
        self.write(path, json.dumps(obj, indent=2, ensure_ascii=False))

    def rm(self, path: str, recursive: bool = False) -> None:
        parent, name = self._walk(path)
        if not name:
            raise FSError("cannot remove /")
        if name not in parent:
            raise FSError(f"no such file or directory: {path}")
        if isinstance(parent[name], dict) and parent[name] and not recursive:
            raise FSError(f"directory not empty: {path}")
        del parent[name]

    def cd(self, path: str) -> str:
        full = self.resolve(path)
        if not self.is_dir(full):
            raise FSError(f"not a directory: {full}")
        self.cwd = full
        return full

    def tree(self, path: str = "/", _prefix: str = "") -> List[str]:
        node = self._node(path)
        lines: List[str] = []
        if not isinstance(node, dict):
            return [posixpath.basename(self.resolve(path))]
        names = sorted(node)
        for i, name in enumerate(names):
            last = i == len(names) - 1
            branch = "└── " if last else "├── "
            child = node[name]
            lines.append(_prefix + branch + (name + "/" if isinstance(child, dict) else name))
            if isinstance(child, dict):
                lines.extend(self.tree(posixpath.join(self.resolve(path), name),
                                       _prefix + ("    " if last else "│   ")))
        return lines

    # ------------------------------------------------------- persistence
    def sync(self) -> Optional[str]:
        if not self.backing_file:
            return None
        directory = os.path.dirname(os.path.abspath(self.backing_file))
        os.makedirs(directory, exist_ok=True)
        with open(self.backing_file, "w", encoding="utf-8") as fh:
            json.dump(self.root, fh, indent=1, ensure_ascii=False)
        return self.backing_file

    # ---------------------------------------------------------- defaults
    def _populate_defaults(self) -> None:
        self.mkdir("/bin")
        self.mkdir("/etc")
        self.mkdir("/home/user")
        self.mkdir("/var/log")
        self.mkdir("/var/results")
        self.mkdir("/lib/circuits")
        self.mkdir("/lib/qbnn")
        self.write("/etc/motd",
                   "Welcome to QubitOS -- an operating system for the APQB quantum computer.\n"
                   "Type 'help' for commands, 'run bell' to start, 'apqb 0.3' to inspect a qubit.\n")
        self.write("/etc/release", json.dumps({"name": "QubitOS", "created": time.time()}))
        self.write("/home/user/hello.qsh",
                   "# QubitOS shell script: an APQB Bell pair\n"
                   "echo preparing |Psi2(theta=0.4)> = cos(0.4)|00> + sin(0.4)|11>\n"
                   "run bell_apqb 0.4 --shots 256 --seed 7\n"
                   "ent last\n")
        self.write("/lib/circuits/bell.json", json.dumps({
            "name": "bell", "num_qubits": 2,
            "instructions": [{"gate": "h", "targets": [0]}, {"gate": "cx", "targets": [0, 1]},
                             {"gate": "measure", "targets": [0, 1]}],
        }, indent=2))
        self.write("/lib/circuits/apqb_register.json", json.dumps({
            "name": "apqb_register", "num_qubits": 3,
            "initial_correlations": [0.9, 0.0, -0.6],
            "instructions": [{"gate": "measure", "targets": [0, 1, 2]}],
        }, indent=2))
