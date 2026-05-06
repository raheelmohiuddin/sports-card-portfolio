import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import awsExports from "./aws-exports.js";
import App from "./App.jsx";
import "./index.css";

Amplify.configure(awsExports);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
