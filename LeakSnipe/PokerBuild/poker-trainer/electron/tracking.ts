import { BrowserWindow } from 'electron';
import { openWindows } from 'get-windows';

const trackedSites = ['CoinPoker', 'betACR'];

// New callback-based tracker that returns bounds
export function checkActiveWindows(callback: (data: any) => void) {
  // getWindows returns promise
  openWindows().then((windows) => {
    try {
      // Find the first visible window matching our sites
      const pokerWindow = windows.find(w => {
         const name = (w as any).processName || (w as any).appName || '';
         const title = w.title || '';
         return trackedSites.some(site => 
           name.includes(site) || title.includes(site)
         );
      });

      if (pokerWindow) {
        const appName = ((pokerWindow as any).processName || (pokerWindow as any).appName)?.replace('.exe', '') || 'Unknown';
        
        callback({
            appName,
            windowTitle: pokerWindow.title,
            bounds: pokerWindow.bounds // { x, y, width, height }
        });
      }
    } catch (e) {
      console.error('Error in window filter', e);
    }
  }).catch(err => console.error('getWindows error', err));
}

// Keeping the old signature briefly but redirecting logic?
// Actually let's just replace the exported function in main.ts
export async function trackActiveWindow(win: BrowserWindow | null) {
  // This was the old poller. We can keep it or replace it.
  setInterval(() => {
    checkActiveWindows((data) => {
       // Send data to renderer
       if (win && !win.isDestroyed()) {
         win.webContents.send('active-window-data', data);
       }
       
       // Update Overlay
       // We need to import overlayManager here or pass it in.
       // Ideally tracking just emits data, and main.ts handles the wiring.
       // But capturing overlayManager here might be circular.
       // Let's modify trackActiveWindow to accept a callback or use the exported one.
    });
  }, 1000);
}
