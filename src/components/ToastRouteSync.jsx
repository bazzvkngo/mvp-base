import React, { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { sileo } from "sileo";

function ToastRouteSync() {
  const { pathname } = useLocation();
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;

    previousPathnameRef.current = pathname;
    sileo.clear();
  }, [pathname]);

  return null;
}

export default ToastRouteSync;
