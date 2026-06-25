"use client";

import { useEffect } from "react";
import { registerEvmAdapter } from "~/lib/evm-adapter";

export function RegisterAdapters() {
  useEffect(() => {
    registerEvmAdapter();
  }, []);

  return null;
}
