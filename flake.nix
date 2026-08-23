{
  description = "code-review-agent TypeScript toolchain dev shell (Issue #250)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_26
            pnpm
            biome
            git
            gh
            # Python side kept in the devShell until Issue #255 removes it
            # (Python and TypeScript coexist for the duration of the Epic).
            python314
            uv
            pre-commit
          ];

          shellHook = ''
            echo "code-review-agent TS toolchain devShell"
            echo "node: $(node -v)"
            echo "pnpm: $(pnpm -v)"
            echo "python: $(python3 --version)"
            echo "uv: $(uv --version)"
            echo "gh: $(gh --version | head -1)"

            pre-commit install

            # Keep everyone on the same Stacked PR tooling: gh extensions
            # aren't Nix packages, so install it here, pinned to a known
            # release tag. Only installs once (checked via `gh extension
            # list` first) so repeat shell entries don't hit the network
            # or silently drift past the pin via an implicit upgrade.
            if gh extension list 2>/dev/null | grep -q "github/gh-stack"; then
              echo "gh-stack: $(gh stack --version)"
            else
              gh extension install github/gh-stack --pin v0.1.0 >/dev/null 2>&1 \
                && echo "gh-stack: $(gh stack --version)" \
                || echo "warning: could not install gh-stack extension (offline?)"
            fi
          '';
        };
      }
    );
}
