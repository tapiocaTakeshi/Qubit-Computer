"""``python -m qubit_computer`` boots QubitOS."""

import sys

from .os.boot import main

sys.exit(main())
