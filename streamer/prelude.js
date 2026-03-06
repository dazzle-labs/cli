import './style.css';
import React, {
    useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
    useContext, useLayoutEffect, useImperativeHandle, useDebugValue,
    useDeferredValue, useTransition, useId, useSyncExternalStore,
    createContext, forwardRef, memo, lazy, Suspense,
} from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

Object.assign(window, {
    React, useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
    useContext, useLayoutEffect, useImperativeHandle, useDebugValue,
    useDeferredValue, useTransition, useId, useSyncExternalStore,
    createContext, forwardRef, memo, lazy, Suspense,
    createRoot, createPortal, create, persist,
});
