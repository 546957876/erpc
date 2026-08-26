import { configureStore, createSlice } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";

type SessionState = { authenticated: boolean };

const sessionSlice = createSlice({
  name: "session",
  initialState: { authenticated: false } as SessionState,
  reducers: {
    connected(state) {
      state.authenticated = true;
    },
    disconnected(state) {
      state.authenticated = false;
    },
  },
});

export const store = configureStore({ reducer: { session: sessionSlice.reducer } });
export const { connected, disconnected } = sessionSlice.actions;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
