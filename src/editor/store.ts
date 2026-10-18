import { useSyncExternalStore } from "react";

/**
 * A small external store for state that changes with every pointer move (cursor, hover, pan and zoom). Components
 * that draw it subscribe on their own, so moving the pointer re-renders a marker instead of the whole editor.
 */
export interface Store<T> {
  get: () => T;
  set: (next: T | ((current: T) => T)) => void;
  /** Merges a partial state; listeners run only when a value actually changes. */
  patch: (partial: Partial<T>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => { for (const l of [...listeners]) l(); };
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === "function" ? (next as (current: T) => T)(state) : next;
      if (value === state) return;
      state = value;
      emit();
    },
    patch: (partial) => {
      let changed = false;
      for (const key of Object.keys(partial) as Array<keyof T>) if (!Object.is(state[key], partial[key])) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...partial };
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Reads one slice of a store; the component re-renders only when that slice changes. */
export function useStore<T, S>(store: Store<T>, select: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
