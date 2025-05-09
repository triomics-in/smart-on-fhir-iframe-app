import { useEffect, useState } from 'react';
import './App.css';

interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  [key: string]: string | undefined;
}

function Callback() {
  const [params, setParams] = useState<CallbackParams>({});
  const [timestamp, setTimestamp] = useState<string>('');

  useEffect(() => {
    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const callbackParams: CallbackParams = {};
    
    urlParams.forEach((value, key) => {
      callbackParams[key] = value;
    });

    setParams(callbackParams);
    const currentTimestamp = new Date().toISOString();
    setTimestamp(currentTimestamp);

    // Send message to opener window and close popup
    if (window.opener) {
      console.log('Sending message to opener window:', callbackParams);
      try {
        window.opener.postMessage({
          type: 'AUTH_CALLBACK',
          params: callbackParams,
          timestamp: currentTimestamp
        }, '*');
        
        // Close the popup after a short delay to ensure message is sent
        setTimeout(() => {
          window.close();
        }, 1000);
      } catch (error) {
        console.error('Error sending message to opener:', error);
      }
    } else {
      // If not in popup, send to parent
      console.log('Sending message to parent window:', callbackParams);
      try {
        window.parent.postMessage({
          type: 'AUTH_CALLBACK',
          params: callbackParams,
          timestamp: currentTimestamp
        }, '*');
      } catch (error) {
        console.error('Error sending message to parent:', error);
      }
    }
  }, []);

  return (
    <div className="callback-container">
      <div className="callback-content">
        <h1>Authorization Callback</h1>
        <div className="callback-info">
          <div className="timestamp">
            Received at: {new Date(timestamp).toLocaleString()}
          </div>
          
          <div className="params-section">
            <h2>Callback Parameters</h2>
            {Object.keys(params).length > 0 ? (
              <div className="params-list">
                {Object.entries(params).map(([key, value]) => (
                  <div key={key} className="param-item">
                    <div className="param-header">
                      <span className="param-key">{key}</span>
                      <span className="param-type">{typeof value}</span>
                    </div>
                    <div className="param-value">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-params">
                No parameters received
              </div>
            )}
          </div>

          {params.error && (
            <div className="error-section">
              <h2>Authorization Error</h2>
              <div className="error-details">
                <div className="error-item">
                  <span className="error-label">Error:</span>
                  <span className="error-value">{params.error}</span>
                </div>
                {params.error_description && (
                  <div className="error-item">
                    <span className="error-label">Description:</span>
                    <span className="error-value">{params.error_description}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="status-section">
            <h2>Authorization Status</h2>
            <div className={`status-indicator ${params.error ? 'error' : 'success'}`}>
              {params.error ? 'Authorization Failed' : 'Authorization Successful'}
            </div>
          </div>
        </div>
      </div>

      <style>
        {`
          .callback-container {
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #f0f2f5;
            padding: 20px;
          }

          .callback-content {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 24px;
            width: 100%;
            max-width: 800px;
          }

          .callback-content h1 {
            color: #1a1a1a;
            margin: 0 0 24px 0;
            font-size: 24px;
          }

          .callback-info {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .timestamp {
            color: #666;
            font-size: 14px;
          }

          .params-section, .error-section, .status-section {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 16px;
          }

          .params-section h2, .error-section h2, .status-section h2 {
            color: #1a1a1a;
            margin: 0 0 16px 0;
            font-size: 18px;
          }

          .params-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .param-item {
            background: white;
            border: 1px solid #e8e8e8;
            border-radius: 4px;
            padding: 12px;
          }

          .param-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          }

          .param-key {
            font-family: monospace;
            font-weight: 500;
            color: #1890ff;
          }

          .param-type {
            font-size: 12px;
            color: #666;
            background: #f0f0f0;
            padding: 2px 6px;
            border-radius: 3px;
          }

          .param-value {
            font-family: monospace;
            color: #333;
            word-break: break-all;
          }

          .no-params {
            text-align: center;
            color: #666;
            padding: 24px;
          }

          .error-section {
            background: #fff2f0;
            border: 1px solid #ffccc7;
          }

          .error-details {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .error-item {
            display: flex;
            gap: 8px;
          }

          .error-label {
            font-weight: 500;
            color: #f5222d;
            min-width: 100px;
          }

          .error-value {
            color: #333;
          }

          .status-section {
            text-align: center;
          }

          .status-indicator {
            display: inline-block;
            padding: 8px 16px;
            border-radius: 4px;
            font-weight: 500;
          }

          .status-indicator.success {
            background: #e3fcef;
            color: #00a854;
          }

          .status-indicator.error {
            background: #fff1f0;
            color: #f5222d;
          }
        `}
      </style>
    </div>
  );
}

export default Callback; 