const express = require('express');
const puppeteer = require('puppeteer');
const PQueue = require('p-queue').default;

const app = express();
app.use(express.json());

const queue = new PQueue({ concurrency: 3 });

let browser;
(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
})();

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

//app.post('/crawl', async (req, res) => {
  //let { url, maxPages = 5 } = req.body;
  
app.get('/crawl', async (req, res) => {
  const url = req.query.url;
  const maxPages = parseInt(req.query.maxPages) || 5;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Debes enviar una URL válida en el body.' });
  }

  queue.add(async () => {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);
    const products = [];

    try {
      // Detectar total de páginas dinámicamente en la primera carga
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const detectedPages = await page.evaluate(() => {
        const textNodes = Array.from(document.querySelectorAll('*'))
          .map(el => el.textContent.trim())
          .filter(t => t.includes('de') && /\d/.test(t));
        const match = textNodes.find(t => /de\s+\d+/.test(t));
        if (match) {
          const num = match.match(/de\s+(\d+)/);
          return num ? parseInt(num[1], 10) : null;
        }
        return null;
      });

      if (detectedPages && detectedPages < maxPages) {
        maxPages = detectedPages;
      }

      // Construir URLs para cada página
      const urlsToVisit = [url];
      for (let i = 2; i <= maxPages; i++) {
        urlsToVisit.push(`${url}${url.includes('?') ? '&' : '?'}pag=${i}`);
      }

      for (const pageUrl of urlsToVisit) {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await autoScroll(page);

        const pageProducts = await page.$$eval('.styled--productcard-container', items =>
          items.map(item => {
            const title = item.querySelector('.product-name')?.textContent.trim() || '';
            const brand = item.querySelector('.product-brand')?.textContent.trim() || '';
            const productUrl = item.querySelector('.styled--link-container')?.href || '';
            const imageUrl = item.querySelector('.product-card-image img')?.src || '';
            const price = item.querySelector('.product-price')?.textContent.trim() || '';
            return { title, brand, productUrl, imageUrl, price };
          })
        );

        products.push(...pageProducts);
      }

      res.json({
        totalProducts: products.length,
        pagesVisited: urlsToVisit.length,
        maxPagesDetected: maxPages,
        products
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    } finally {
      await page.close();
    }
  });
});

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let lastHeight = document.body.scrollHeight;
      const interval = setInterval(() => {
        window.scrollTo(0, document.body.scrollHeight);
        if (document.body.scrollHeight === lastHeight) {
          clearInterval(interval);
          resolve();
        } else {
          lastHeight = document.body.scrollHeight;
        }
      }, 500);
    });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API lista en http://localhost:${PORT}`));

