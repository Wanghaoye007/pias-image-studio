import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/noto-sans-sc';
import '@xyflow/react/dist/style.css';
import App from './App';
import './styles/styles.css';
import './styles/design-tokens.css';
import './styles/soft-glass.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
