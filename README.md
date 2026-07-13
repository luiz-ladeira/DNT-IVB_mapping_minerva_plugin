---
title: "DNT-IVB mapping Plugin – Documentation"
author: "Luiz Ladeira"
date: "2026_07_13"
output: html_document
---

# Introduction

The **DNT-IVB mapping Plugin** is an extension for **MINERVA v18 or higher**.
It loads a Google Sheet cataloguing **Developmental Neurotoxicity (DNT)
In-Vitro Battery (IVB)** assays and their mapping to the elements of the
displayed MINERVA map. Each assay is anchored to a map element through the
`Element_id` column; selecting a row highlights and focuses the corresponding
BioEntity directly on the map.

Main features:

-   Automatic fetch of the DNT-IVB assay catalog from Google Sheets.
-   Clean, high-contrast, searchable and filterable assay table.
-   Free-text search across all columns plus dropdown filters
    (submap relevance, regulatory status, and assessed entity).
-   Row-to-map anchoring by **`Element_id`**: clicking a mapped row
    highlights (pin) and focuses the element on the map.
-   `Reference` DOIs are rendered as clickable hyperlinks (resolved via
    `https://doi.org/`).
-   Visual indicator dot per row: a **green** dot marks an assay mapped to a
    map element (clickable), a **red** dot marks a row not mapped to the map.
    Hovering a dot shows a tooltip reading "Mapped" or "Not mapped".
-   **Access data** shortcut to the source Google Sheet.
-   **Clean** button to reset search, filters, and highlights.
-   **Compact expandable rows**: to avoid horizontal scrolling, only a few
    narrow *primary* columns are shown (Assay, Entity, Regulatory status). A
    ▶ toggle on each row expands a detail panel below it with the remaining
    fields (Relevance (submap), Reference DOI, cell-model columns, and any
    other column present). This is the same space-saving pattern used by the
    MINERVA *drug-reactions* plugin. Which columns are primary is set by the
    `PRIMARY_COLUMNS` constant in `src/js/index.js`.
-   **Column-adaptive**: the table renders whatever columns exist in the
    sheet. Adding or removing a column is picked up automatically; only the
    columns referenced *by name* (see Configuration) get special treatment.
    Any column not listed in `PRIMARY_COLUMNS` automatically appears in the
    row detail panel.
-   **No API key**: data is fetched through the keyless public Google Sheets
    export, so no secret is embedded in the client-side code.
-   **Auto-fitting panel**: the panel fills the available height down to the
    bottom of the MINERVA plugin drawer and re-fits dynamically when the
    window/screen is resized. It scrolls internally (horizontal and vertical
    scrollbars) when the content is larger than the available space.
-   **MINERVA drawer header**: shown by default (`HIDE_HOST_CHROME = false`),
    so the plugin sits in its natural slot below MINERVA's own
    plugin-drawer header ("Plugin: … / Open new plugin") and stays aligned to
    the bottom of the drawer. An optional space-reclaiming mode can hide that
    header — set `HIDE_HOST_CHROME = true` at the top of `src/js/index.js`.
    When enabled it is a best-effort DOM tweak that fails silently if MINERVA's
    layout differs, and it also removes MINERVA's in-drawer refresh/close
    controls (the plugin can still be closed/reopened from the main **Plugins**
    menu). Any change the plugin makes to MINERVA's own DOM is recorded and
    **restored when the plugin is unloaded**, via an `onPluginUnload` listener,
    so closing the plugin never leaves a blank panel behind.

-   **Full-height panel**: the plugin gives MINERVA's `.tab-content` drawer
    `position: relative` so its container fills the available slot; the table
    then fills the remaining height and owns the single scrollbar.

------------------------------------------------------------------------

# Dependencies

The plugin relies on:

-   **MINERVA API (v18+)**
-   **Google Sheets API v4**
-   **jQuery** (bundled)
-   Custom CSS styles (`styles.css`, bundled into `plugin.js`)

------------------------------------------------------------------------

# Configuration

The plugin is configured to use a fixed Google Sheet, fetched **without an
API key** via the public Google Visualization (gviz) JSON export. The sheet
must be shared as *"Anyone with the link can view"*.

-   **Spreadsheet ID**: `1bxuDsq2Wbf6ijzaOeDhW0u8qvhEnDqqFsVPDzrWhrbE`
-   **Sheet tab**: `data`
-   **Anchor column (row → map element)**: `Element_id`
-   **Model disambiguation column**: `model_id`
-   **Hyperlinked column (DOI)**: `Reference`
-   **Dropdown filter columns**: `Relevance_(submap)`, `Regulatory_status`,
    `Entity`

Rows whose `Element_id` is empty or a placeholder (`/`, `a`, `-`, `n/a`) are
shown in the table but are not clickable/highlightable, since they are not yet
mapped to a map element.

Columns are otherwise handled generically: any column present in the sheet is
displayed (except the hidden ones above), so you can add or remove columns —
e.g. a `Comment` column — without changing the plugin code, as long as the
mapping/DOI/filter columns keep their names.

These values are defined as constants at the top of `src/js/index.js`.

------------------------------------------------------------------------

# Usage

When loaded in MINERVA:

1.  A panel with the DNT-IVB assay table is rendered.
2.  Use the **search box** to filter rows by any text (assay name, entity,
    cell model, etc.).
3.  Use the **dropdown filters** to narrow by submap relevance, regulatory
    status, or assessed entity.
4.  Clicking a **mapped** row (marked with a filled dot) highlights the
    corresponding element on the map and focuses the view on it.
5.  **Access data** opens the source Google Sheet in a new tab.
6.  **Clean** clears the search, resets the filters, and removes highlights.
7.  On load, all mapped elements are highlighted; the visible-match set is
    re-highlighted as you search/filter.
8.  The panel automatically fits the space MINERVA allocates; scroll bars
    appear (horizontally and vertically) when the table is larger than the
    panel.

------------------------------------------------------------------------

# Building

```
npm install
npm run build
```

This compiles `src/css/styles.scss` → `styles.css`, transpiles the sources
with Babel, and bundles everything (including CSS and jQuery) with browserify
into `dist/plugin.js`. A copy of the built bundle is also kept at the
repository root as `plugin.js` for direct loading in MINERVA.

------------------------------------------------------------------------

# Error Handling

-   If the Google Sheet fetch fails → an error message is displayed in the
    plugin container.
-   If MINERVA version \< 18 → an alert notifies the user that the plugin
    requires MINERVA v18+.

------------------------------------------------------------------------

# Versioning

-   **Plugin name**: DNT-IVB mapping

-   **Version**: 0.4

-   **Author**: Luiz Ladeira

-   Repository: <https://github.com/luiz-ladeira/DNT-IVB_mapping_minerva_plugin>

-   Repurposed from the Cardiotox AOP / KE Methods Mapper plugin, itself based
    on previous development by Hesam Korki - <https://github.com/HesamKorki>

-   The compact expandable-row layout (narrow primary columns with the
    remaining fields in a per-row detail panel, to save horizontal space) is
    adapted from the MINERVA **Adverse Drug Reactions** (`drug-reactions`)
    plugin -
    <https://gitlab.com/uniluxembourg/lcsb/BioCore/minerva/plugins/drug-reactions>

------------------------------------------------------------------------

# Licencing

-   **CC BY 4.0**: Attribution 4.0 International (see `Licence.md`)

------------------------------------------------------------------------

# References

-   [MINERVA API documentation](https://minerva.pages.uni.lu/doc/)
-   [Google Sheets API v4](https://developers.google.com/sheets/api)
