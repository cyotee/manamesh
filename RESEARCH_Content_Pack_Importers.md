### Card Game Platforms with Content/Plugin/Pack Systems

Here is a compiled list of the projects I referenced earlier that use some form of content packs, plugins, or modular asset systems. I've included official or primary URLs (as of early 2026) for each, focusing on the most reliable sources for downloads, documentation, and community resources. These will be useful for researching their pack formats when designing importers/converters.

- **LackeyCCG**  
  Generic platform supporting many TCGs/CCGs via folder-based or zipped plugins (card data + images).  
  Official site: https://www.lackeyccg.com/  
  Plugin directory/examples: https://www.lackeyccg.com/plugins.html

- **OCTGN (Online Card Table Game Network)**  
  Uses XML-defined games and separate image packs (zipped .o8c containers or folder structures).  
  Official site: https://www.octgn.net/  
  GitHub (source + game definitions): https://github.com/octgn/OCTGN

- **Cockatrice**  
  XML card data with local folder or zipped image packs; supports custom downloads.  
  Official site/GitHub: https://cockatrice.github.io/  
  Main repository: https://github.com/Cockatrice/Cockatrice  
  Image pack resources: Often community-hosted (e.g., via Woogerworks mirrors or forum threads)

- **Tabletop Simulator**  
  Custom decks via sprite sheets, hosted URLs, or AssetBundles; extensive modding via Steam Workshop.  
  Official site: https://www.tabletopsimulator.com/  
  Steam page: https://store.steampowered.com/app/286160/Tabletop_Simulator/  
  Workshop (for custom card games): https://steamcommunity.com/app/286160/workshop/  
  Documentation on custom decks: https://kb.tabletopsimulator.com/custom-content/custom-deck

- **Minecraft Resource Packs**  
  Standard zip-based packs with JSON metadata (pack.mcmeta) and folder overrides; widely used model for asset replacement.  
  Official documentation: https://minecraft.wiki/w/Resource_pack  
  Community hub/examples: https://www.curseforge.com/minecraft/resource-packs  
  Format specification: https://minecraft.wiki/w/Resource_pack#Contents

### Additional Related Projects (Worth Checking for Pack Ideas)

These weren't in my original list but are similar open-source card game platforms with asset/pack systems:

- **XMage** (Magic: The Gathering simulator)  
  Supports card images via downloadable packs or custom folders.  
  Official site: https://xmage.de/  
  GitHub: https://github.com/magefree/mage

- **Forge** (MTG-focused, cross-platform)  
  Uses reskinnable themes and card image caches/packs.  
  GitHub: https://github.com/Card-Forge/forge  
  Releases/downloads: https://releases.cardforge.org/

These should give you a solid starting point for analyzing existing pack structures (folder layouts, manifests, compression, etc.) and planning conversion tools. Let me know if you want deeper dives into any specific one's format!
