import { configureStore, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { combineReducers } from "redux";
import { persistReducer, persistStore } from "redux-persist";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";

const storageSession = {
  getItem: (key: string) => Promise.resolve(sessionStorage.getItem(key)),
  setItem: (key: string, value: string) => { sessionStorage.setItem(key, value); return Promise.resolve(); },
  removeItem: (key: string) => { sessionStorage.removeItem(key); return Promise.resolve(); },
};

type SessionState = {
  connected: boolean;
  webToken: string;
};

const initialState: SessionState = { connected: false, webToken: "" };

const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {
    connected(state, action: PayloadAction<string>) {
      state.connected = true;
      state.webToken = action.payload;
    },
    disconnected(state) {
      state.connected = false;
      state.webToken = "";
    },
  },
});

const rootReducer = combineReducers({ session: sessionSlice.reducer });
const persistedReducer = persistReducer(
  { key: "erpc-admin", storage: storageSession, whitelist: ["session"] },
  rootReducer,
);

export const store = configureStore({ reducer: persistedReducer, middleware: (getDefault) => getDefault({ serializableCheck: false }) });
export const persistor = persistStore(store);
export const { connected, disconnected } = sessionSlice.actions;
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
