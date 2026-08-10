import { existsSync } from "node:fs";
import { basename } from "node:path";
import { AgentSkills } from "@strands-agents/sdk/vended-plugins/skills";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSkillType, createAgentSkills, SKILLS_DIR } from "./agent-skills-factory.js";

vi.mock("@strands-agents/sdk/vended-plugins/skills", () => ({
  AgentSkills: vi.fn().mockImplementation((config: unknown) => ({ __config: config })),
}));

const mockedAgentSkills = vi.mocked(AgentSkills);

function skillsOf(call: unknown[] | undefined): string[] {
  return (call?.[0] as { skills: string[] } | undefined)?.skills ?? [];
}

function basenamesOf(call: unknown[] | undefined): string[] {
  return skillsOf(call).map((path) => basename(path));
}

describe("SKILLS_DIR", () => {
  it("resolves to an existing directory", () => {
    expect(existsSync(SKILLS_DIR)).toBe(true);
  });
});

describe("createAgentSkills", () => {
  beforeEach(() => {
    mockedAgentSkills.mockClear();
  });

  it("resolves the skills directory to the existing Python-owned location", () => {
    createAgentSkills(AgentSkillType.WEB_SECURITY_REVIEW);

    const skills = skillsOf(mockedAgentSkills.mock.calls[0]);
    expect(skills).toHaveLength(1);
    expect(existsSync(skills[0] as string)).toBe(true);
    expect(skills[0]).toMatch(/src\/code_review_agent\/skills\/reviewing-web-security$/);
  });

  it("builds the React review bundle", () => {
    createAgentSkills(AgentSkillType.REACT_REVIEW);

    expect(basenamesOf(mockedAgentSkills.mock.calls[0])).toEqual([
      "reviewing-universal",
      "reviewing-languages",
      "reviewing-frameworks",
      "reviewing-metaframeworks",
      "vercel-react-best-practices",
      "vercel-composition-patterns",
    ]);
  });

  it("builds the Angular review bundle", () => {
    createAgentSkills(AgentSkillType.ANGULAR_REVIEW);

    expect(basenamesOf(mockedAgentSkills.mock.calls[0])).toEqual([
      "reviewing-universal",
      "reviewing-languages",
      "reviewing-frameworks",
      "angular-developer",
    ]);
  });

  it("builds the Svelte review bundle", () => {
    createAgentSkills(AgentSkillType.SVELTE_REVIEW);

    expect(basenamesOf(mockedAgentSkills.mock.calls[0])).toEqual([
      "reviewing-universal",
      "reviewing-languages",
      "reviewing-frameworks",
      "svelte-core-bestpractices",
    ]);
  });

  it("builds the Vue review bundle without a dedicated Vue skill package", () => {
    createAgentSkills(AgentSkillType.VUE_REVIEW);

    expect(basenamesOf(mockedAgentSkills.mock.calls[0])).toEqual([
      "reviewing-universal",
      "reviewing-languages",
      "reviewing-frameworks",
    ]);
  });

  it("builds the web security review bundle", () => {
    createAgentSkills(AgentSkillType.WEB_SECURITY_REVIEW);

    expect(basenamesOf(mockedAgentSkills.mock.calls[0])).toEqual(["reviewing-web-security"]);
  });

  it("builds an empty bundle for AgentSkillType.NONE, including as the default", () => {
    createAgentSkills(AgentSkillType.NONE);
    createAgentSkills();

    expect(basenamesOf(mockedAgentSkills.mock.calls[0])).toEqual([]);
    expect(basenamesOf(mockedAgentSkills.mock.calls[1])).toEqual([]);
  });

  it("all real skill directories referenced by every bundle exist on disk", () => {
    for (const skillType of Object.values(AgentSkillType)) {
      createAgentSkills(skillType);
    }

    const allPaths = mockedAgentSkills.mock.calls.flatMap((call) => skillsOf(call));
    for (const path of allPaths) {
      expect(existsSync(path)).toBe(true);
    }
  });
});
