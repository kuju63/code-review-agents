import * as i18n from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next";

i18n
  .use(initReactI18next)
  .use(
    resourcesToBackend(
      (language: string, namespace: string) => import(`/locales/${language}/${namespace}.json`),
    ),
  )
  .on("failedLoading", (_lng, _ns, msg) => console.error(msg))
  .init({
    lng: "ja",
    fallbackLng: "ja",
    interpolation: {
      escapeValue: false,
    },
  });
