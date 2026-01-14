(async () => {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    const email = "YOUR@EMAIL.HERE";
    const batchSize = 12;
    let updatedCount = 0;

    if (!items.length) return;

    const itemsWithDOI = items.filter(item => item.isRegularItem() && item.getField('DOI'));


    function reconstructAbstract(invertedIndex) {
        if (!invertedIndex) return "";
        let abstractArray = [];
        for (const [word, positions] of Object.entries(invertedIndex)) {
            for (const pos of positions) {
                abstractArray[pos] = word;
            }
        }
        return abstractArray.join(" ");
    }

    for (let i = 0; i < itemsWithDOI.length; i += batchSize) {
        const chunk = itemsWithDOI.slice(i, i + batchSize);
        
        await Promise.all(chunk.map(async (item) => {
            const doi = item.getField('DOI').trim();
            const cleanDOI = doi.replace(/^https?:\/\/doi\.org\//, "");
            const apiUrl = `https://api.openalex.org/works/doi:${cleanDOI}?mailto=${email}`;

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) return;

                const data = await response.json();
                let changed = false;

                if (!item.getField('abstractNote') && data.abstract_inverted_index) {
                    const abstractText = reconstructAbstract(data.abstract_inverted_index);
                    if (abstractText) {
                        item.setField('abstractNote', abstractText);
                        changed = true;
                    }
                }

                if (data.ids && data.ids.isbn) {
                    const currentISBN = item.getField('ISBN');
                    if (!currentISBN) {
                        // Limpa o formato 'urn:isbn:' se presente
                        const cleanISBN = Array.isArray(data.ids.isbn) 
                            ? data.ids.isbn[0].replace(/urn:isbn:/g, "")
                            : data.ids.isbn.replace(/urn:isbn:/g, "");
                        
                        // Verifica se o tipo de item suporta o campo ISBN
                        if (Zotero.ItemFields.isValidField(item.itemTypeID, 'ISBN')) {
                            item.setField('ISBN', cleanISBN);
                            changed = true;
                        }
                    }
                }

                if (data.biblio) {
                    if (!item.getField('volume') && data.biblio.volume) {
                        item.setField('volume', data.biblio.volume);
                        changed = true;
                    }
                    if (!item.getField('issue') && data.biblio.issue) {
                        item.setField('issue', data.biblio.issue);
                        changed = true;
                    }
                    if (!item.getField('pages') && data.biblio.first_page) {
                        const pages = data.biblio.last_page 
                            ? `${data.biblio.first_page}-${data.biblio.last_page}`
                            : data.biblio.first_page;
                        item.setField('pages', pages);
                        changed = true;
                    }
                }

                if (data.keywords && data.keywords.length > 0) {
                    for (let kw of data.keywords) {
                        item.addTag(kw.display_name);
                        changed = true;
                    }
                }

                if (data.open_access?.oa_url && (!item.getField('url') || item.getField('url').includes('doi.org'))) {
                    item.setField('url', data.open_access.oa_url);
                    changed = true;
                }

                let extraContent = item.getField('extra') || "";
                if (data.sustainable_development_goals?.length > 0 && !extraContent.includes("SDG:")) {
                    const sdgs = data.sustainable_development_goals.map(s => s.display_name).join('; ');
                    item.setField('extra', extraContent + (extraContent ? "\n" : "") + `SDG: ${sdgs}`);
                    changed = true;
                }

                if (changed) {
                    await item.saveTx();
                    updatedCount++;
                }
            } catch (err) {
                console.error(`ERROR: DOI ${doi}:`, err);
            }
        }));
    }

    return `Itś ready. ${updatedCount} updated items.`;
})();
