from pathlib import Path

import pytest


ROOT = Path(__file__).parents[2]
RUNTIME_DIGEST = "e36a6b6597232eb40ff1589d7a329adaed9ec1ea6a44efb55a8d9f8c9a10ae9d"
BUILDER_DIGEST = "26331b730e4593b11bc703b8bb31b60be55383ef49aecbc5ef90a1c54d2a1942"


def test_dockerfile_uses_pinned_red_hat_hardened_images() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text()

    assert (
        "FROM registry.access.redhat.com/hi/python:3.14-builder"
        f"@sha256:{BUILDER_DIGEST} AS builder"
    ) in dockerfile
    assert (
        "FROM registry.access.redhat.com/hi/python:3.14"
        f"@sha256:{RUNTIME_DIGEST} AS runtime"
    ) in dockerfile
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
