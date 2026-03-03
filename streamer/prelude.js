import React, { useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

Object.assign(window, {
    React, useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
    createRoot, create, persist,
});
