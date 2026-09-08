import * as i18n from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

const localeModules = import.meta.glob<{ default: unknown }>("./locales/*/*.json");

i18n
  .use(initReactI18next)
  .use(
    resourcesToBackend((language: string, namespace: string) => {
      const loader = localeModules[`./locales/${language}/${namespace}.json`];
      if (!loader) {
        throw new Error(`Missing locale resource: ${language}/${namespace}`);
      }
      return loader();
    }),
  )
  .on("failedLoading", (_lng, _ns, msg) => console.error(msg))
  .init({
    lng: "ja",
    fallbackLng: "ja",
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
