// Plain module (not "use client"), so the server layout can inline these strings.
export const THEME_KEY = "twin-theme";

/** Inline script run before paint so the stored theme applies without a flash. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;
