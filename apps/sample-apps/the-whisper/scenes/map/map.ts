import { ContentPackage } from "../../content/ContentPackage.js";
import { preferredLanguage } from "../../content/preferredLanguage.js";
import { ViennaMapModal } from "../../ui/ViennaMapModal.js";

// Standalone Map Scene: automatically opens and embeds the Vienna folded map
void (async (): Promise<void> => {
  const texts = await ContentPackage.load(preferredLanguage());
  const map = new ViennaMapModal(texts, "flakturm_arenberg");
  map.open();
})();
