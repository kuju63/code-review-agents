import re
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[2]


def test_dockerfile_uses_pinned_red_hat_hardened_images() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text()

    assert re.search(
        r"^FROM registry\.access\.redhat\.com/hi/python:3\.14-builder"
        r"@sha256:[0-9a-f]{64} AS builder$",
        dockerfile,
        re.MULTILINE,
    )
    assert re.search(
        r"^FROM registry\.access\.redhat\.com/hi/python:3\.14"
        r"@sha256:[0-9a-f]{64} AS runtime$",
        dockerfile,
        re.MULTILINE,
    )
    assert "cgr.dev/chainguard/python" not in dockerfile
    assert "ARG PYTHON_VERSION" not in dockerfile
    assert (
        "COPY --from=builder /app/pysite /usr/lib/python3.14/site-packages/"
        in dockerfile
    )
    assert "USER 65532" in {line.strip() for line in dockerfile.splitlines()}


@pytest.mark.parametrize(
    ("workflow_path", "job_name"),
    [
        (".github/workflows/build-image.yml", "build"),
        (".github/workflows/container-security-scan.yml", "trivy-scan"),
    ],
)
def test_container_workflow_logs_in_to_red_hat_registry(
    workflow_path: str,
    job_name: str,
) -> None:
    workflow = (ROOT / workflow_path).read_text()
    workflow_lines = workflow.splitlines()
    job_start = workflow_lines.index(f"  {job_name}:")
    job_end = next(
        (
            index
            for index, line in enumerate(workflow_lines[job_start + 1 :], job_start + 1)
            if line.startswith("  ") and not line.startswith("    ")
        ),
        len(workflow_lines),
    )
    lines = [line.rstrip() for line in workflow_lines[job_start:job_end]]

    login_marker = "      - name: Login to Red Hat registry"
    build_marker = "        uses: docker/build-push-action@v7"
    assert lines.index(login_marker) < lines.index(build_marker)
    assert "          registry: registry.access.redhat.com" in lines
    assert "          username: ${{ secrets.REDHAT_CLIENTID }}" in lines
    assert "          password: ${{ secrets.REDHAT_CLIENT_SECRET }}" in lines
