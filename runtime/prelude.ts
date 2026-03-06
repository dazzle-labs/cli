/**
 * Prelude — bundles React, ReactDOM, and Zustand as browser globals.
 *
 * Loaded before renderer.js. Exposes React hooks, utilities, and Zustand
 * on `window` so the renderer and agent scripts can use them directly.
 */

import React, {
  useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
  useContext, useLayoutEffect, useImperativeHandle, useDebugValue,
  useDeferredValue, useTransition, useId, useSyncExternalStore,
  createContext, forwardRef, memo, lazy, Suspense,
} from "react"
import { createRoot } from "react-dom/client"
import { createPortal } from "react-dom"
import { create } from "zustand"
import { persist } from "zustand/middleware"

Object.assign(window, {
  React, createElement: React.createElement, createRoot,
  useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
  useContext, useLayoutEffect, useImperativeHandle, useDebugValue,
  useDeferredValue, useTransition, useId, useSyncExternalStore,
  createContext, forwardRef, memo, lazy, Suspense,
  createPortal, create, persist,
})
