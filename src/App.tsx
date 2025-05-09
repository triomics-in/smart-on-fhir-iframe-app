import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import './App.css'
import Callback from './Callback'

interface ContextSource {
  method: string;
  timestamp: string;
  data: any;
  source?: string;
}

interface OAuthParams {
  clientId: string;
  iss: string;
  launch?: string;
}

interface CookieInfo {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  secure: boolean;
  httpOnly: boolean;
  isSession: boolean;
}

interface UrlInfo {
  url: string;
  timestamp: string;
}

interface IframeContext {
  referrer: string;
  parentOrigin: string;
  windowSize: {
    width: number;
    height: number;
  };
  userAgent: string;
  timestamp: string;
  contextHistory: ContextSource[];
  cookies: {
    parent: string[];
    current: string[];
  };
  authFlow: {
    status: 'idle' | 'initiated' | 'completed' | 'error';
    timestamp: string;
    details: {
      authUrl: string;
      params: OAuthParams;
      hasExistingAuth?: boolean;
      cookies?: {
        parent: CookieInfo[];
        current: CookieInfo[];
      };
      urls: UrlInfo[];
      usedExistingAuth?: boolean;
      error?: string;
      queryParams?: Record<string, string>;
    };
  };
}

interface StorageData {
  source: string;
  data: Record<string, any>;
  timestamp: string;
  accessible: boolean;
  error?: string;
}

interface RequestError {
  type: 'CDS' | 'USER' | 'STORAGE';
  message: string;
  timestamp: string;
}

// Move function declarations before their usage
const getCookiesForDomain = (domain: string): CookieInfo[] => {
  try {
    return document.cookie
      .split(';')
      .map(cookie => cookie.trim())
      .filter(cookie => {
        const parsed = parseCookie(cookie);
        return parsed.domain === domain || parsed.domain === `.${domain}`;
      })
      .map(cookie => parseCookie(cookie));
  } catch (error) {
    console.warn('Error accessing cookies:', error);
    return [];
  }
};

const parseCookie = (cookieStr: string): CookieInfo => {
  const [nameValue, ...rest] = cookieStr.split(';');
  const [name, value] = nameValue.split('=').map(part => part.trim());
  
  const cookie: CookieInfo = {
    name,
    value,
    domain: '',
    path: '/',
    expires: '',
    secure: false,
    httpOnly: false,
    isSession: true
  };

  rest.forEach(part => {
    const [key, val] = part.split('=').map(p => p.trim());
    switch (key.toLowerCase()) {
      case 'domain':
        cookie.domain = val;
        break;
      case 'path':
        cookie.path = val;
        break;
      case 'expires':
        cookie.expires = val;
        cookie.isSession = false;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
    }
  });

  return cookie;
};

const constructAuthUrl = async (iss: string, launch?: string) => {
  try {
    // Fetch metadata from ISS endpoint
    const metadataUrl = `${iss}/metadata`;
    console.log('metadataUrl', metadataUrl);
    const response = await fetch(metadataUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.status}`);
    }
    const metadata = await response.json();
    
    // Get authorization endpoint from metadata extensions
    let authEndpoint = '';
    if (metadata.rest && metadata.rest[0]?.security?.extension) {
      const oauthExtension = metadata.rest[0].security.extension.find(
        (ext: any) => ext.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
      );
      
      if (oauthExtension?.extension) {
        const authorizeExtension = oauthExtension.extension.find(
          (ext: any) => ext.url === 'authorize'
        );
        if (authorizeExtension?.valueUri) {
          authEndpoint = authorizeExtension.valueUri;
        }
      }
    }

    if (!authEndpoint) {
      throw new Error('Authorization endpoint not found in metadata');
    }

    // Construct authorization URL with parameters
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'e44d31df-8033-4dc2-ab0e-6fefb16a4d01',
      redirect_uri: 'https://58cc-157-20-14-23.ngrok-free.app/callback',
      scope: 'launch/patient',
      state: '98wrghuwuogerg97',
      aud: iss
    });

    // Add launch parameter if it exists
    if (launch) {
      params.append('launch', launch);
    }

    console.log('authEndpoint', authEndpoint);

    return `${authEndpoint}?${params.toString()}`;
  } catch (error) {
    console.error('Error constructing auth URL:', error);
    // Fallback to hardcoded URL if metadata fetch fails
    const baseUrl = 'https://interopio.ontada.com/av2/oauth2/authorize';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'e44d31df-8033-4dc2-ab0e-6fefb16a4d01',
      redirect_uri: 'https://58cc-157-20-14-23.ngrok-free.app/callback',
      scope: 'launch/patient',
      state: '98wrghuwuogerg97',
      aud: iss
    });

    // Add launch parameter if it exists
    if (launch) {
      params.append('launch', launch);
    }

    return `${baseUrl}?${params.toString()}`;
  }
};

const AuthComponent: React.FC<{
  authUrl: string;
  onAuthComplete: (params: any, timestamp: string) => void;
  onAuthError: (error: string, description?: string) => void;
}> = ({ authUrl, onAuthComplete, onAuthError }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [popup, setPopup] = useState<Window | null>(null);
  const authStartedRef = useRef(false);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);

  useEffect(() => {
    if (!authUrl || authStartedRef.current) return;

    const startAuth = () => {
      console.log('Starting authorization process...');
      setIsLoading(true);
      authStartedRef.current = true;

      // Open popup window
      const popupWindow = window.open(
        authUrl,
        'auth_popup',
        'width=800,height=600,resizable=yes,scrollbars=yes'
      );

      if (!popupWindow) {
        console.error('Failed to open popup window');
        setIsLoading(false);
        onAuthError('Failed to open authorization window');
        return;
      }

      setPopup(popupWindow);
      setCurrentUrl(authUrl);

      // Create message handler
      messageHandlerRef.current = (event: MessageEvent) => {
        console.log('Received message:', event.data);
        if (event.data?.type === 'AUTH_CALLBACK') {
          console.log('Processing AUTH_CALLBACK:', event.data);
          const { params, timestamp } = event.data;
          
          if (params.error) {
            console.error('Authorization error:', params.error);
            onAuthError(params.error, params.error_description);
          } else {
            console.log('Authorization successful:', params);
            onAuthComplete(params, timestamp);
          }
          
          // Clean up
          if (popupWindow) {
            popupWindow.close();
          }
          setIsLoading(false);
        }
      };

      // Add message listener
      window.addEventListener('message', messageHandlerRef.current);

      // Check if popup was closed
      const checkPopup = setInterval(() => {
        if (popupWindow.closed) {
          console.log('Popup window was closed');
          clearInterval(checkPopup);
          setIsLoading(false);
          onAuthError('Authorization window was closed');
        }
      }, 1000);

      // Cleanup
      return () => {
        console.log('Cleaning up auth component...');
        clearInterval(checkPopup);
        if (messageHandlerRef.current) {
          window.removeEventListener('message', messageHandlerRef.current);
        }
        if (popupWindow && !popupWindow.closed) {
          popupWindow.close();
        }
      };
    };

    startAuth();
  }, [authUrl, onAuthComplete, onAuthError]);

  return (
    <div className="auth-container">
      {isLoading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <div className="loading-text">Opening authorization window...</div>
        </div>
      ) : (
        <div className="auth-content">
          <div className="auth-section">
            <h2>Authorization URL</h2>
            <div className="url-display">
              <code>{currentUrl}</code>
              <button
                className="copy-button"
                onClick={() => navigator.clipboard.writeText(currentUrl)}
              >
                Copy
              </button>
            </div>
            <div className="auth-info">
              <div className="info-row">
                <span className="info-label">Status:</span>
                <span className="info-value">Ready</span>
              </div>
              <div className="info-row">
                <span className="info-label">Window:</span>
                <span className="info-value">800x600</span>
              </div>
              <div className="info-row">
                <span className="info-label">Last Updated:</span>
                <span className="info-value">{new Date().toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>
        {`
          .auth-container {
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 20px;
            margin: 16px 0;
          }

          .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 32px;
            background: #f8f9fa;
            border-radius: 8px;
          }

          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #1890ff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 16px;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .loading-text {
            color: #1890ff;
            font-size: 16px;
            font-weight: 500;
          }

          .auth-content {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .auth-section {
            background: #f8f9fa;
            border-radius: 6px;
            padding: 16px;
          }

          .auth-section h2 {
            color: #1a1a1a;
            margin: 0 0 16px 0;
            font-size: 18px;
            font-weight: 600;
          }

          .url-display {
            display: flex;
            align-items: center;
            gap: 12px;
            background: white;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid #e8e8e8;
            margin-bottom: 16px;
          }

          .url-display code {
            flex: 1;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 14px;
            color: #1890ff;
            word-break: break-all;
            padding: 8px;
            background: #f0f7ff;
            border-radius: 4px;
          }

          .copy-button {
            background: #1890ff;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 8px 16px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
            white-space: nowrap;
          }

          .copy-button:hover {
            background: #40a9ff;
          }

          .auth-info {
            background: white;
            border-radius: 6px;
            padding: 16px;
            border: 1px solid #e8e8e8;
          }

          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
          }

          .info-row:last-child {
            border-bottom: none;
          }

          .info-label {
            color: #666;
            font-size: 14px;
            font-weight: 500;
          }

          .info-value {
            color: #1a1a1a;
            font-size: 14px;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
          }
        `}
      </style>
    </div>
  );
};

function MainApp() {
  const [context, setContext] = useState<IframeContext | null>({
    referrer: document.referrer,
    parentOrigin: 'Unknown (Cross-origin)',
    windowSize: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    contextHistory: [],
    cookies: {
      parent: getCookiesForDomain('ontada.com').map(cookie => `${cookie.name}=${cookie.value}`),
      current: document.cookie.split(';').map(cookie => cookie.trim())
    },
    authFlow: {
      status: 'idle',
      timestamp: new Date().toISOString(),
      details: {
        authUrl: '',
        urls: [],
        params: {
          clientId: '',
          iss: ''
        }
      }
    }
  });
  const [callbackData, setCallbackData] = useState<{
    params: Record<string, string>;
    timestamp: string;
  } | null>(null);
  const [storageData, setStorageData] = useState<StorageData[]>([]);
  const [requestErrors, setRequestErrors] = useState<RequestError[]>([]);
  const contextInitializedRef = useRef(false);

  // Helper function to safely get parent origin
  const tryGetParentOrigin = () => {
    try {
      return window.parent.origin;
    } catch (e) {
      return null;
    }
  };

  // Handle initial context setup - only runs once
  useEffect(() => {
    if (contextInitializedRef.current) return;
    contextInitializedRef.current = true;

    const updateContext = async () => {
      const newContext: IframeContext = {
        referrer: document.referrer,
        parentOrigin: window.parent !== window ? 
          (tryGetParentOrigin() || 'Cross-origin parent') : 
          'Not in iframe',
        windowSize: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
        contextHistory: [],
        cookies: {
          parent: getCookiesForDomain('ontada.com').map(cookie => `${cookie.name}=${cookie.value}`),
          current: document.cookie.split(';').map(cookie => cookie.trim())
        },
        authFlow: {
          status: 'idle',
          timestamp: new Date().toISOString(),
          details: {
            authUrl: '',
            urls: [],
            params: {
              clientId: '',
              iss: ''
            }
          }
        }
      };

      // Add initial URL parameters to context history
      const params = new URLSearchParams(window.location.search);
      if (params.toString()) {
        const urlContext: Record<string, any> = {};
        params.forEach((value, key) => {
          try {
            urlContext[key] = JSON.parse(value);
          } catch {
            urlContext[key] = value === 'null' ? null : value;
          }
        });
        newContext.contextHistory.push({
          method: 'URL Parameters',
          timestamp: new Date().toISOString(),
          data: urlContext,
          source: 'Initial Load'
        });

        if (!urlContext.clientId || urlContext.clientId === 'null') {
          urlContext.clientId = 'e44d31df-8033-4dc2-ab0e-6fefb16a4d01';
        }

        if (urlContext.iss) {
          const oauthParams: OAuthParams = {
            clientId: urlContext.clientId,
            iss: urlContext.iss,
            launch: urlContext.launch || null
          };
          newContext.authFlow = {
            status: 'initiated',
            timestamp: new Date().toISOString(),
            details: {
              authUrl: '',
              params: oauthParams,
              urls: [{
                url: '',
                timestamp: new Date().toISOString()
              }]
            }
          };

          const authUrl = await constructAuthUrl(urlContext.iss, urlContext.launch);
          newContext.authFlow = {
            ...newContext.authFlow,
            status: 'initiated',
            details: {
              ...newContext.authFlow.details,
              authUrl,
              urls: [{
                url: authUrl,
                timestamp: new Date().toISOString()
              }]
            }
          };
        }
      }

      setContext(newContext);
    };

    updateContext();
  }, []);

  // Handle auth completion
  const handleAuthComplete = useCallback((params: Record<string, string>, timestamp: string) => {
    console.log('Handling auth completion:', params, timestamp);
    setCallbackData({ params, timestamp });
    setContext(prev => {
      if (!prev) return null;
      return {
        ...prev,
        authFlow: {
          ...prev.authFlow,
          status: 'completed',
          timestamp: new Date().toISOString(),
          details: {
            ...prev.authFlow.details,
            queryParams: params
          }
        }
      };
    });
  }, []);

  // Handle auth error
  const handleAuthError = useCallback((error: string, description?: string) => {
    console.error('Handling auth error:', error, description);
    setContext(prev => {
      if (!prev) return null;
      return {
        ...prev,
        authFlow: {
          status: 'error',
          timestamp: new Date().toISOString(),
          details: {
            ...prev.authFlow.details,
            error,
            errorDescription: description
          }
        }
      };
    });
  }, []);

  return (
    <div className="app-container">
      <h1>Iframe Context Information</h1>
      {context && (
        <div className="context-info">
          <div className="info-item">
            <h3>Basic Information:</h3>
            <div className="basic-info">
              <p><strong>Referrer:</strong> {context.referrer || 'No referrer'}</p>
              <p><strong>Parent Origin:</strong> {context.parentOrigin}</p>
              <p><strong>Window Size:</strong> {context.windowSize.width}px × {context.windowSize.height}px</p>
              <p><strong>User Agent:</strong> {context.userAgent}</p>
              <p><strong>Last Updated:</strong> {context.timestamp}</p>
            </div>
          </div>

          {context.cookies && (
            <div className="info-item">
              <h3>Browser Cookies</h3>
              <div className="cookies-info">
                <div className="cookie-section">
                  <h4>Parent Domain Cookies (interopio.ontada.com)</h4>
                  {context.cookies.parent.length > 0 ? (
                    <ul className="cookie-list">
                      {context.cookies.parent.map((cookie, index) => {
                        const parsedCookie = parseCookie(cookie);
                        return (
                          <li key={index} className="cookie-item">
                            <span className="cookie-name">{parsedCookie.name}</span>
                            <div className="cookie-value">{parsedCookie.value}</div>
                            <span className="cookie-domain">
                              <div className="cookie-attribute">
                                <strong>Domain:</strong> {parsedCookie.domain || 'Not specified'}
                              </div>
                              <div className="cookie-attribute">
                                <strong>Path:</strong> {parsedCookie.path || '/'}
                              </div>
                              <div className="cookie-attribute">
                                <strong>Expires:</strong> {parsedCookie.isSession ? 'Session' : (parsedCookie.expires || 'Not specified')}
                              </div>
                              <div className="cookie-attribute">
                                <strong>Secure:</strong> {parsedCookie.secure ? 'Yes' : 'No'}
                              </div>
                              <div className="cookie-attribute">
                                <strong>HttpOnly:</strong> {parsedCookie.httpOnly ? 'Yes' : 'No'}
                              </div>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="no-cookies">No cookies found for parent domain</div>
                  )}
                </div>

                <div className="cookie-section">
                  <h4>Current Domain Cookies</h4>
                  {context.cookies.current.length > 0 ? (
                    <ul className="cookie-list">
                      {context.cookies.current.map((cookie, index) => {
                        const parsedCookie = parseCookie(cookie);
                        return (
                          <li key={index} className="cookie-item">
                            <span className="cookie-name">{parsedCookie.name}</span>
                            <div className="cookie-value">{parsedCookie.value}</div>
                            <span className="cookie-domain">
                              <div className="cookie-attribute">
                                <strong>Domain:</strong> {parsedCookie.domain || 'Not specified'}
                              </div>
                              <div className="cookie-attribute">
                                <strong>Path:</strong> {parsedCookie.path || '/'}
                              </div>
                              <div className="cookie-attribute">
                                <strong>Expires:</strong> {parsedCookie.isSession ? 'Session' : (parsedCookie.expires || 'Not specified')}
                              </div>
                              <div className="cookie-attribute">
                                <strong>Secure:</strong> {parsedCookie.secure ? 'Yes' : 'No'}
                              </div>
                              <div className="cookie-attribute">
                                <strong>HttpOnly:</strong> {parsedCookie.httpOnly ? 'Yes' : 'No'}
                              </div>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="no-cookies">No cookies found for current domain</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {context.authFlow?.details?.params && (
            <div className="info-item">
              <h3>OAuth Parameters:</h3>
              <div className="oauth-info">
                <p><strong>Client ID:</strong> {context.authFlow.details.params.clientId}</p>
                <p><strong>ISS:</strong> {context.authFlow.details.params.iss}</p>
                {context.authFlow.details.params.launch && (
                  <p><strong>Launch:</strong> {context.authFlow.details.params.launch}</p>
                )}
                {context.authFlow.details.authUrl && (
                  <div className="auth-url">
                    <p><strong>Authorization URL:</strong></p>
                    <a href={context.authFlow.details.authUrl} target="_blank" rel="noopener noreferrer">
                      {context.authFlow.details.authUrl}
                    </a>
                    <div className="callback-url">
                      <p><strong>Callback URL:</strong></p>
                      <code>https://58cc-157-20-14-23.ngrok-free.app/callback</code>
                    </div>
                    <div className="url-details">
                      <p><strong>Base URL:</strong> https://58cc-157-20-14-23.ngrok-free.app</p>
                      <p><strong>Full Callback Path:</strong> https://58cc-157-20-14-23.ngrok-free.app/callback</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {context.authFlow && (
            <div className="info-item">
              <h3>Authorization Flow:</h3>
              <div className="auth-flow">
                <p><strong>Status:</strong> {context.authFlow.status}</p>
                <p><strong>Timestamp:</strong> {new Date(context.authFlow.timestamp).toLocaleString()}</p>
                {context.authFlow.details && (
                  <div className="auth-details">
                    <pre>{JSON.stringify(context.authFlow.details, null, 2)}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {context.contextHistory.length > 0 && (
            <div className="info-item">
              <h3>Context History:</h3>
              <div className="context-history">
                {context.contextHistory.map((source, index) => (
                  <div key={index} className="context-source">
                    <div className="source-header">
                      <span className="method">{source.method}</span>
                      <span className="timestamp">{new Date(source.timestamp).toLocaleTimeString()}</span>
                    </div>
                    {source.source && (
                      <div className="source-info">
                        <span className="source-label">Source:</span>
                        <span className="source-value">{source.source}</span>
                      </div>
                    )}
                    <pre>{JSON.stringify(source.data, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="info-item">
            <h3>Session Storage Data</h3>
            <div className="storage-info">
              {storageData.map((storage, index) => (
                <div key={index} className="storage-section">
                  <div className="storage-header">
                    <h4>{storage.source}</h4>
                    <div className="storage-status">
                      <span className={`status-indicator ${storage.accessible ? 'accessible' : 'inaccessible'}`}>
                        {storage.accessible ? '✓ Accessible' : '✗ Not Accessible'}
                      </span>
                      <span className="timestamp">Last updated: {new Date(storage.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                  
                  {storage.error && (
                    <div className="storage-error">
                      <span className="error-icon">⚠️</span>
                      <span className="error-message">{storage.error}</span>
                    </div>
                  )}

                  {storage.accessible && Object.keys(storage.data).length > 0 ? (
                    <div className="storage-content">
                      <div className="storage-summary">
                        <span className="key-count">{Object.keys(storage.data).length} items found</span>
                      </div>
                      <div className="storage-items">
                        {Object.entries(storage.data).map(([key, value]) => (
                          <div key={key} className="storage-item">
                            <div className="storage-item-header">
                              <span className="storage-key">{key}</span>
                              <span className="storage-type">{typeof value}</span>
                            </div>
                            <div className="storage-value">
                              {typeof value === 'object' ? (
                                <pre>{JSON.stringify(value, null, 2)}</pre>
                              ) : (
                                <span className="storage-value-text">{String(value)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="no-storage-data">
                      {storage.accessible ? (
                        <div className="empty-state">
                          <span className="empty-icon">📭</span>
                          <span className="empty-message">No data found in session storage</span>
                        </div>
                      ) : (
                        <div className="inaccessible-state">
                          <span className="inaccessible-icon">🔒</span>
                          <span className="inaccessible-message">
                            Storage not accessible due to cross-origin restrictions
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Add some CSS for the new storage component */}
          <style>
            {`
              .storage-section {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 16px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              }

              .storage-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
              }

              .storage-header h4 {
                margin: 0;
                color: #2c3e50;
                font-size: 1.1em;
              }

              .storage-status {
                display: flex;
                align-items: center;
                gap: 12px;
              }

              .status-indicator {
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 0.9em;
                font-weight: 500;
              }

              .status-indicator.accessible {
                background: #e3fcef;
                color: #00a854;
              }

              .status-indicator.inaccessible {
                background: #fff1f0;
                color: #f5222d;
              }

              .storage-error {
                background: #fff2f0;
                border: 1px solid #ffccc7;
                border-radius: 4px;
                padding: 8px 12px;
                margin: 8px 0;
                display: flex;
                align-items: center;
                gap: 8px;
                color: #f5222d;
              }

              .storage-content {
                background: white;
                border-radius: 6px;
                padding: 12px;
                margin-top: 12px;
              }

              .storage-summary {
                margin-bottom: 12px;
                color: #666;
                font-size: 0.9em;
              }

              .storage-items {
                display: flex;
                flex-direction: column;
                gap: 12px;
              }

              .storage-item {
                background: #fafafa;
                border: 1px solid #f0f0f0;
                border-radius: 4px;
                padding: 12px;
              }

              .storage-item-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
              }

              .storage-key {
                font-family: monospace;
                font-weight: 500;
                color: #1890ff;
              }

              .storage-type {
                font-size: 0.8em;
                color: #666;
                background: #f0f0f0;
                padding: 2px 6px;
                border-radius: 3px;
              }

              .storage-value {
                background: white;
                border: 1px solid #f0f0f0;
                border-radius: 4px;
                padding: 8px;
              }

              .storage-value pre {
                margin: 0;
                white-space: pre-wrap;
                word-break: break-word;
              }

              .storage-value-text {
                font-family: monospace;
                color: #333;
              }

              .no-storage-data {
                padding: 24px;
                text-align: center;
                background: white;
                border-radius: 6px;
                margin-top: 12px;
              }

              .empty-state, .inaccessible-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                color: #666;
              }

              .empty-icon, .inaccessible-icon {
                font-size: 24px;
              }

              .timestamp {
                color: #666;
                font-size: 0.9em;
              }

              .callback-url {
                margin-top: 16px;
                padding: 12px;
                background: #f8f9fa;
                border-radius: 4px;
                border: 1px solid #e8e8e8;
              }

              .callback-url p {
                margin: 0 0 8px 0;
                color: #666;
              }

              .callback-url code {
                display: block;
                padding: 8px;
                background: white;
                border: 1px solid #e8e8e8;
                border-radius: 4px;
                font-family: monospace;
                color: #1890ff;
                word-break: break-all;
              }

              .url-details {
                margin-top: 12px;
                padding: 12px;
                background: #f0f7ff;
                border-radius: 4px;
                border: 1px solid #91caff;
              }

              .url-details p {
                margin: 4px 0;
                font-family: monospace;
                color: #1677ff;
              }

              .url-details strong {
                color: #0958d9;
              }

              .auth-info {
                background: #f8f9fa;
                border-bottom: 1px solid #e9ecef;
                padding: 12px;
              }

              .auth-url-info {
                display: flex;
                flex-direction: column;
                gap: 8px;
              }

              .url-section {
                display: flex;
                flex-direction: column;
                gap: 4px;
              }

              .url-section label {
                font-size: 12px;
                color: #495057;
                font-weight: 500;
              }

              .url-display {
                display: flex;
                align-items: center;
                gap: 8px;
                background: white;
                padding: 6px 8px;
                border-radius: 4px;
                border: 1px solid #dee2e6;
              }

              .url-display code {
                flex: 1;
                font-size: 12px;
                color: #22863a;
                word-break: break-all;
              }

              .copy-btn {
                background: #e9ecef;
                border: 1px solid #ced4da;
                border-radius: 4px;
                padding: 2px 8px;
                font-size: 11px;
                color: #495057;
                cursor: pointer;
                transition: all 0.2s;
                white-space: nowrap;
              }

              .copy-btn:hover {
                background: #dee2e6;
                border-color: #adb5bd;
              }

              .browser-address-bar {
                flex: 1;
                display: flex;
                align-items: center;
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                padding: 4px 8px;
                margin: 0 8px;
              }

              .url-icon {
                margin-right: 8px;
                color: #495057;
              }

              .browser-address-bar input {
                flex: 1;
                border: none;
                background: transparent;
                font-size: 13px;
                color: #495057;
                outline: none;
              }
            `}
          </style>

          {requestErrors.length > 0 && (
            <div className="info-item">
              <h3>Request Errors</h3>
              <div className="error-list">
                {requestErrors.map((error, index) => (
                  <div key={index} className="error-item">
                    <span className="error-type">{error.type}</span>
                    <span className="error-message">{error.message}</span>
                    <span className="error-timestamp">{new Date(error.timestamp).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {context.authFlow?.details?.authUrl && (
            <div className="info-item">
              <h3>Authorization:</h3>
              <AuthComponent
                authUrl={context.authFlow.details.authUrl}
                onAuthComplete={handleAuthComplete}
                onAuthError={handleAuthError}
              />
            </div>
          )}

          {callbackData && (
            <div className="info-item">
              <h3>Authorization Callback Data:</h3>
              <div className="callback-data">
                <div className="callback-status">
                  <div className={`status-badge ${callbackData.params.error ? 'error' : 'success'}`}>
                    {callbackData.params.error ? 'Authorization Failed' : 'Authorization Successful'}
                  </div>
                  <div className="timestamp">
                    Received at: {new Date(callbackData.timestamp).toLocaleString()}
                  </div>
                </div>

                <div className="callback-params">
                  <h4>Callback Parameters:</h4>
                  {Object.entries(callbackData.params).map(([key, value]) => (
                    <div key={key} className="param-row">
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

                {callbackData.params.error && (
                  <div className="error-details">
                    <h4>Error Details:</h4>
                    <div className="error-item">
                      <span className="error-label">Error:</span>
                      <span className="error-value">{callbackData.params.error}</span>
                    </div>
                    {callbackData.params.error_description && (
                      <div className="error-item">
                        <span className="error-label">Description:</span>
                        <span className="error-value">{callbackData.params.error_description}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <style>
            {`
              .callback-data {
                background: #f8f9fa;
                border-radius: 8px;
                padding: 16px;
              }

              .callback-status {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding-bottom: 16px;
                border-bottom: 1px solid #e9ecef;
              }

              .status-badge {
                padding: 6px 12px;
                border-radius: 4px;
                font-weight: 500;
                font-size: 14px;
              }

              .status-badge.success {
                background: #e3fcef;
                color: #00a854;
              }

              .status-badge.error {
                background: #fff1f0;
                color: #f5222d;
              }

              .timestamp {
                color: #666;
                font-size: 14px;
              }

              .callback-params {
                margin-bottom: 16px;
              }

              .callback-params h4 {
                margin: 0 0 12px 0;
                color: #1a1a1a;
                font-size: 16px;
              }

              .param-row {
                background: white;
                border: 1px solid #e8e8e8;
                border-radius: 4px;
                padding: 12px;
                margin-bottom: 8px;
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
                background: #fafafa;
                padding: 8px;
                border-radius: 4px;
              }

              .error-details {
                background: #fff2f0;
                border: 1px solid #ffccc7;
                border-radius: 4px;
                padding: 16px;
              }

              .error-details h4 {
                margin: 0 0 12px 0;
                color: #f5222d;
                font-size: 16px;
              }

              .error-item {
                display: flex;
                gap: 8px;
                margin-bottom: 8px;
              }

              .error-label {
                font-weight: 500;
                color: #f5222d;
                min-width: 100px;
              }

              .error-value {
                color: #333;
              }
            `}
          </style>
        </div>
      )}
      <style>
        {`
          .loading-indicator {
            margin-top: 16px;
            padding: 12px;
            background-color: #e6f7ff;
            border: 1px solid #91d5ff;
            border-radius: 4px;
            color: #1890ff;
            text-align: center;
            font-size: 14px;
          }

          .auth-button {
            margin-top: 16px;
            padding: 8px 16px;
            background-color: #1890ff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.3s;
          }

          .auth-button:hover {
            background-color: #40a9ff;
          }

          .auth-button:disabled {
            background-color: #d9d9d9;
            cursor: not-allowed;
          }
        `}
      </style>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/callback" element={<Callback />} />
        <Route path="/" element={<MainApp />} />
      </Routes>
    </Router>
  );
}

export default App
