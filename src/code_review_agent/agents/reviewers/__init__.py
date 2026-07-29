"""Concrete reviewers.

Importing this package registers every reviewer with the registry as a side
effect.  Add new reviewer modules here so they are discovered by the
orchestrator.
"""

from .angular import AngularReviewer
from .frontend import FrontendReviewer
from .security import SecurityReviewer
from .svelte import SvelteReviewer
from .vue import VueReviewer

__all__ = [
    "AngularReviewer",
    "FrontendReviewer",
    "SecurityReviewer",
    "SvelteReviewer",
    "VueReviewer",
]
