// Shared logging function for all pages
function logError(error) {
    const errorData = {
      message: error.message || String(error),
      stack: error.stack || 'No stack trace',
      page: window.location.pathname.split('/').pop() || 'unknown',
      timestamp: new Date().toISOString()
    };
  
    // Send to Cloud Function
    fetch('https://logerror-pfsz2i2hia-uc.a.run.app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errorData),
      mode: 'cors'
    }).catch(e => console.error('Failed to log:', e));
  }
  
  // Global error handler (catches unhandled errors)
  window.onerror = (message, source, lineno, colno, error) => {
    logError(error || { message, stack: `${source}:${lineno}:${colno}` });
  };