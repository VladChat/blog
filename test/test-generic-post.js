const assert = require("assert").strict;
const expect = require("expect.js");
const { JSDOM } = require("jsdom");
const readFileSync = require("fs").readFileSync;
const existsSync = require("fs").existsSync;
const metadata = require("../_data/metadata.json");
const GA_ID = require("../_data/googleanalytics.js")();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * These tests kind of suck and they are kind of useful.
 *
 * They suck, because they need to be changed when the hardcoded post changes.
 * They are useful because I tend to break the things they test all the time.
 */

describe("check build output for a generic post", () => {
  describe("sample post", () => {
    const POST_FILENAME = "_site/posts/firstpost/index.html";
    const SITE_URL = metadata.url;
    const POST_URL = SITE_URL + "/posts/firstpost/";
    const PATH_PREFIX = (() => {
      try {
        return new URL(SITE_URL).pathname.replace(/\/$/, "");
      } catch (error) {
        return "";
      }
    })();
    const withPrefix = (pathname) => `${PATH_PREFIX}${pathname}`;

    if (!existsSync(POST_FILENAME)) {
      it("WARNING skipping tests because POST_FILENAME does not exist", () => {});
      return;
    }

    let dom;
    let html;
    let doc;

    function select(selector, opt_attribute) {
      const element = doc.querySelector(selector);
      assert(element, "Expected to find: " + selector);
      if (opt_attribute) {
        return element.getAttribute(opt_attribute);
      }
      return element.textContent;
    }

    before(() => {
      html = readFileSync(POST_FILENAME);
      dom = new JSDOM(html);
      doc = dom.window.document;
    });

    it("should have metadata", () => {
      assert.equal(select("title"), "This is my first post.");
      expect(select("meta[property='og:image']", "content")).to.match(
        /https?:\/\//
      );
      assert.equal(select("link[rel='canonical']", "href"), POST_URL);
      assert.equal(
        select("meta[name='description']", "content"),
        "This is a post on My Blog about agile frameworks."
      );
    });

    it("should have inlined css", () => {
      const css = select("style");
      expect(css).to.match(/header nav/);
      expect(css).to.not.match(/test-dead-code-elimination-sentinel/);
    });

    it("should have script elements", () => {
      const scripts = doc.querySelectorAll("script[src]");
      let has_ga_id = GA_ID ? 1 : 0;
      expect(scripts).to.have.length(has_ga_id + 1); // NOTE: update this when adding more <script>
      const minJs = scripts[0].getAttribute("src");
      const minPattern = new RegExp(
        `^${escapeRegExp(withPrefix("/js/min.js"))}\\?hash=\\w+`
      );
      expect(minJs).to.match(minPattern);
    });

    it("should have GA a setup", () => {
      if (!GA_ID) {
        return;
      }
      const scripts = doc.querySelectorAll("script[src]");
      const cachedPattern = new RegExp(
        `^${escapeRegExp(withPrefix("/js/cached.js"))}\\?hash=\\w+`
      );
      expect(scripts[1].getAttribute("src")).to.match(cachedPattern);
      const noscript = doc.querySelectorAll("noscript");
      expect(noscript.length).to.be.greaterThan(0);
      let count = 0;
      for (let n of noscript) {
        if (n.textContent.includes(withPrefix("/api/ga"))) {
          count++;
          expect(n.textContent).to.contain(GA_ID);
        }
      }
      expect(count).to.equal(1);
    });

    /*
    // Update me. Comment in if you turned on the CSP support.
    it("should have a good CSP", () => {
      const csp = select(
        "meta[http-equiv='Content-Security-Policy']",
        "content"
      );
      expect(csp).to.contain(";object-src 'none';");
      expect(csp).to.match(/^default-src 'self';/);
    });*/

    it("should have accessible buttons", () => {
      const buttons = doc.querySelectorAll("button");
      for (let b of buttons) {
        expect(
          (b.firstElementChild === null && b.textContent.trim()) ||
            b.getAttribute("aria-label") != null
        ).to.be.true;
      }
    });

    it("should have a share widget", () => {
      expect(select("share-widget button", "href")).to.equal(POST_URL);
    });

    it("should have a header", () => {
      expect(select("header > h1")).to.equal("This is my first post.");
      expect(select("header aside")).to.match(/\d+ min read./);
      expect(select("header dialog", "id")).to.equal("message");
    });

    it("should have a published date", () => {
      expect(select("article time")).to.equal("01 May 2018");
      expect(select("article time", "datetime")).to.equal("2018-05-01");
    });

    it("should link to twitter with noopener", () => {
      const twitterLinks = Array.from(doc.querySelectorAll("a")).filter((a) =>
        a.href.startsWith("https://twitter.com")
      );
      for (let a of twitterLinks) {
        expect(a.rel).to.contain("noopener");
        expect(a.target).to.equal("_blank");
      }
    });

    describe("body", () => {
      it("should have images", () => {
        const pictureImages = Array.from(
          doc.querySelectorAll("article :not(aside) picture img")
        );
        const inlineImages = Array.from(
          doc.querySelectorAll("article :not(aside) img")
        );
        const images = pictureImages.length > 0 ? pictureImages : inlineImages;
        const pictures = pictureImages.length > 0
          ? Array.from(doc.querySelectorAll("article :not(aside) picture"))
          : [];
        const metaImage = select("meta[property='og:image']", "content");
        expect(images.length).to.greaterThan(0);
        const img = images[0];
        const localImgPattern = new RegExp(
          `^${escapeRegExp(withPrefix("/img/remote/"))}\\w+-1920w\\.jpg$`
        );
        const remotePattern = /^https?:\/\//;
        expect(img.src).to.match(new RegExp(`${localImgPattern.source}|${remotePattern.source}`));
        expect(metaImage).to.match(/https?:\/\//);
        if (pictures.length > 0) {
          const picture = pictures[0];
          const sources = Array.from(picture.querySelectorAll("source"));
          expect(sources).to.have.length(3);
          const avif = sources.shift();
          const webp = sources.shift();
          const jpg = sources.shift();
          const jpgPattern = new RegExp(
            `${escapeRegExp(withPrefix("/img/remote/"))}\\w+-1920w\.jpg 1920w, ${escapeRegExp(
              withPrefix("/img/remote/")
            )}\\w+-1280w\.jpg 1280w, ${escapeRegExp(withPrefix("/img/remote/"))}\\w+-640w\.jpg 640w, ${escapeRegExp(
              withPrefix("/img/remote/")
            )}\\w+-320w\.jpg 320w`
          );
          const webpPattern = new RegExp(
            `${escapeRegExp(withPrefix("/img/remote/"))}\\w+-1920w\.webp 1920w, ${escapeRegExp(
              withPrefix("/img/remote/")
            )}\\w+-1280w\.webp 1280w, ${escapeRegExp(withPrefix("/img/remote/"))}\\w+-640w\.webp 640w, ${escapeRegExp(
              withPrefix("/img/remote/")
            )}\\w+-320w\.webp 320w`
          );
          const avifPattern = new RegExp(
            `${escapeRegExp(withPrefix("/img/remote/"))}\\w+-1920w\.avif 1920w, ${escapeRegExp(
              withPrefix("/img/remote/")
            )}\\w+-1280w\.avif 1280w, ${escapeRegExp(withPrefix("/img/remote/"))}\\w+-640w\.avif 640w, ${escapeRegExp(
              withPrefix("/img/remote/")
            )}\\w+-320w\.avif 320w`
          );
          expect(jpg.srcset).to.match(jpgPattern);
          expect(webp.srcset).to.match(webpPattern);
          expect(avif.srcset).to.match(avifPattern);
          expect(jpg.type).to.equal("image/jpeg");
          expect(webp.type).to.equal("image/webp");
          //expect(avif.type).to.equal("image/avif");
          expect(jpg.sizes).to.equal("(max-width: 608px) 100vw, 608px");
          expect(webp.sizes).to.equal("(max-width: 608px) 100vw, 608px");
          expect(img.getAttribute("loading")).to.equal("lazy");
          expect(img.getAttribute("decoding")).to.equal("async");
          expect(img.outerHTML).to.match(/svg/);
          expect(img.outerHTML).to.match(/filter/);
        }
        expect(img.height).to.match(/^\d+$/);
        expect(img.width).to.match(/^\d+$/);
        const loadingAttr = img.getAttribute("loading");
        if (!pictures.length && loadingAttr) {
          expect(loadingAttr).to.equal("lazy");
        }
        const decodingAttr = img.getAttribute("decoding");
        if (!pictures.length && decodingAttr) {
          expect(decodingAttr).to.equal("async");
        }
      });

      it("should have json-ld", () => {
        const json = select("script[type='application/ld+json']");
        const images = Array.from(
          doc.querySelectorAll("article :not(aside) img")
        );
        const obj = JSON.parse(json);
        expect(obj.url).to.equal(POST_URL);
        expect(obj.description).to.equal(
          "Leverage agile frameworks to provide a robust synopsis for high level overviews. Iterative approaches to corporate strategy foster..."
        );
        expect(obj.image.length).to.be.greaterThan(0);
        obj.image.forEach((url, index) => {
          const src = images[index].src;
          if (src.startsWith("/")) {
            expect(url).to.equal(SITE_URL + src);
          } else {
            expect(url.endsWith(src)).to.be(true);
          }
        });
      });

      it("should have paragraphs", () => {
        const images = Array.from(doc.querySelectorAll("article > p"));
        expect(images.length).to.greaterThan(0);
      });
    });
  });
});
