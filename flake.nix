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
          ];

          shellHook = ''
            echo "code-review-agent TS toolchain devShell"
            echo "node: $(node -v)"
            echo "pnpm: $(pnpm -v)"
          '';
        };
      }
    );
}
