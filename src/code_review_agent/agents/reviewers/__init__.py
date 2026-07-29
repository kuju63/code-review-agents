"""Concrete reviewers.

Importing this package registers every reviewer with the registry as a side
effect.  Add new reviewer modules here so they are discovered by the
orchestrator.
"""

from .angular import AngularReviewer
from .react import ReactReviewer
from .security import SecurityReviewer
from .svelte import SvelteReviewer
from .vue import VueReviewer

__all__ = [
    "AngularReviewer",
    "ReactReviewer",
    "SecurityReviewer",
    "SvelteReviewer",
    "VueReviewer",
]
