import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, theme } from "antd";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { App } from "./App";
import { persistor, store } from "./app/store";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 3_000 } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider theme={{ algorithm: [theme.darkAlgorithm, theme.compactAlgorithm], token: { colorPrimary: "#5de4c7", borderRadius: 6, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" } }}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConfigProvider>
        </QueryClientProvider>
      </PersistGate>
    </Provider>
  </React.StrictMode>,
);
