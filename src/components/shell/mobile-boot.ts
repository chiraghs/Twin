export const MOBILE_OK_KEY = "twin-mobile-ok";

/** Runs before paint: a visitor who already chose to continue on this device doesn't see the phone notice again this session. */
export const mobileNoticeBootScript = `(function(){try{if(sessionStorage.getItem("${MOBILE_OK_KEY}")==="1")document.documentElement.setAttribute("data-mobile-ok","");}catch(e){}})();`;
