import { Button, InlineNotification, PasswordInput, TextInput } from "@carbon/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./settings.module.scss";
import type { GithubSettings } from "./settings.schema";
import {
  type GithubUrlErrorCode,
  normalizeGithubUrl,
  type PersonalAccessTokenErrorCode,
  validateGithubUrl,
  validatePersonalAccessToken,
} from "./settings.schema";
import { persistHasGithubTokenFlag, SETTINGS_QUERY_KEY, updateGithubSettings } from "./settingsApi";

export interface SettingsFormProps {
  settings: GithubSettings;
}

/**
 * SCR-04 SET-03〜SET-05: owns the editable copy of the GitHub settings, seeded
 * from `settings` (the GET result held by the parent's query) and re-synced
 * whenever a fresh `settings` prop arrives (e.g. a background refetch) as
 * long as the user hasn't started editing — edits always take priority over
 * a refresh. PAT input never carries a persisted value across mounts
 * (SET-A02) — component state is discarded on unmount, so no explicit
 * "clear on leave" handler is needed.
 */
export function SettingsForm({ settings }: SettingsFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const urlInputRef = useRef<HTMLInputElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const [githubUrl, setGithubUrl] = useState(settings.githubUrl);
  const [personalAccessToken, setPersonalAccessToken] = useState("");
  const [hasExistingToken, setHasExistingToken] = useState(settings.hasPersonalAccessToken);
  const [githubUrlError, setGithubUrlError] = useState<GithubUrlErrorCode>();
  const [tokenError, setTokenError] = useState<PersonalAccessTokenErrorCode>();
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [isEdited, setIsEdited] = useState(false);
  const [syncedSettings, setSyncedSettings] = useState(settings);

  if (settings !== syncedSettings) {
    setSyncedSettings(settings);
    if (!isEdited) {
      setGithubUrl(settings.githubUrl);
      setHasExistingToken(settings.hasPersonalAccessToken);
      setTokenError(undefined);
    }
  }

  const mutation = useMutation({
    mutationFn: updateGithubSettings,
    onSuccess: (result) => {
      if (result.ok) {
        persistHasGithubTokenFlag(result.data.hasPersonalAccessToken);
        setHasExistingToken(result.data.hasPersonalAccessToken);
        setGithubUrl(result.data.githubUrl);
        setPersonalAccessToken("");
        setIsEdited(false);
        setSaved(true);
        setSubmitError(undefined);
        queryClient.setQueryData(SETTINGS_QUERY_KEY, result.data);
        return;
      }
      setSaved(false);
      setSubmitError(result.message || t("settings.saveErrorBody"));
    },
    onError: () => {
      setSaved(false);
      setSubmitError(t("settings.saveErrorBody"));
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setSubmitError(undefined);

    const urlErr = validateGithubUrl(githubUrl);
    const patErr = validatePersonalAccessToken(personalAccessToken, hasExistingToken);
    setGithubUrlError(urlErr);
    setTokenError(patErr);

    // SET-A03: focus the first invalid field in on-screen (top-to-bottom) order.
    if (urlErr) {
      urlInputRef.current?.focus();
      return;
    }
    if (patErr) {
      tokenInputRef.current?.focus();
      return;
    }

    mutation.mutate({
      githubUrl: normalizeGithubUrl(githubUrl),
      ...(personalAccessToken.length > 0 ? { personalAccessToken } : {}),
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {saved && (
        <InlineNotification
          kind="success"
          title={t("settings.savedNoticeTitle")}
          aria-label={t("common.close")}
          onCloseButtonClick={() => setSaved(false)}
        />
      )}
      {submitError && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title={t("settings.saveErrorTitle")}
          subtitle={submitError}
        />
      )}
      <TextInput
        id="settings-github-url"
        ref={urlInputRef}
        labelText={t("settings.githubUrlLabel")}
        helperText={githubUrlError ? undefined : t("settings.githubUrlHelper")}
        placeholder="https://github.com"
        value={githubUrl}
        invalid={githubUrlError !== undefined}
        invalidText={githubUrlError ? t(`settings.errors.githubUrl.${githubUrlError}`) : undefined}
        onChange={(event) => {
          setGithubUrl(event.target.value);
          setIsEdited(true);
          setSaved(false);
          setGithubUrlError(undefined);
        }}
      />
      <PasswordInput
        id="settings-github-token"
        ref={tokenInputRef}
        labelText={t("settings.tokenLabel")}
        helperText={tokenError ? undefined : t("settings.tokenHelper")}
        placeholder={
          hasExistingToken
            ? t("settings.tokenPlaceholderRegistered")
            : t("settings.tokenPlaceholderNew")
        }
        value={personalAccessToken}
        invalid={tokenError !== undefined}
        invalidText={
          tokenError ? t(`settings.errors.personalAccessToken.${tokenError}`) : undefined
        }
        showPasswordLabel={t("settings.tokenShowLabel")}
        hidePasswordLabel={t("settings.tokenHideLabel")}
        onChange={(event) => {
          setPersonalAccessToken(event.target.value);
          setIsEdited(true);
          setSaved(false);
          setTokenError(undefined);
        }}
      />
      <div>
        <Button type="submit" disabled={mutation.isPending}>
          {t("settings.saveButton")}
        </Button>
      </div>
    </form>
  );
}
