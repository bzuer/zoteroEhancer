# zoteroEhancer
A .js script to enhance bibliographic data in Zotero

**Select the items** > Tools > Developer > Run JavaScript 

```js
(async () => {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    const email = "myemail@mail.me";
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
                        const cleanISBN = Array.isArray(data.ids.isbn) 
                            ? data.ids.isbn[0].replace(/urn:isbn:/g, "")
                            : data.ids.isbn.replace(/urn:isbn:/g, "");
                        
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
                console.error(`Erro no processamento do DOI ${doi}:`, err);
            }
        }));
    }

    return `Processamento concluído. ${updatedCount} itens atualizados com metadados estendidos.`;
})();
```

for books: 

```js
(async () => {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    const apiKey = ""; // Opcional
    const batchSize = 12;
    let updatedCount = 0;

    if (!items.length) return;

    const itemsWithISBN = items.filter(item => 
        item.isRegularItem() && (
            item.itemType === "book" || 
            item.itemType === "bookSection" ||
            item.getField('ISBN')
        )
    );

    if (!itemsWithISBN.length) {
        return "Nenhum livro ou item com ISBN selecionado.";
    }

    for (let i = 0; i < itemsWithISBN.length; i += batchSize) {
        const chunk = itemsWithISBN.slice(i, i + batchSize);
        
        await Promise.all(chunk.map(async (item) => {
            let isbn = item.getField('ISBN');
            
            if (!isbn) {
                const extra = item.getField('extra') || '';
                const url = item.getField('url') || '';
                const doi = item.getField('DOI') || '';
                
                const isbnPattern = /\b(?:ISBN(?:-1[03])?:?\s*)?(?=[0-9X]{10}|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}|97[89][0-9]{10}|(?=(?:[0-9]+[- ]){4})[- 0-9]{17})(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]\b/g;
                
                const searchText = [extra, url, doi].join(' ');
                const matches = searchText.match(isbnPattern);
                
                if (matches && matches.length > 0) {
                    isbn = matches[0].replace(/ISBN(?:-1[03])?:?\s*/gi, '')
                                     .replace(/[- ]/g, '')
                                     .toUpperCase();
                }
            } else {
                isbn = isbn.replace(/ISBN(?:-1[03])?:?\s*/gi, '')
                           .replace(/[- ]/g, '')
                           .toUpperCase();
            }

            if (!isbn) return;

            let apiUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`;
            if (apiKey && apiKey.trim()) {
                apiUrl += `&key=${encodeURIComponent(apiKey.trim())}`;
            }

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) return;

                const data = await response.json();
                
                if (!data.totalItems || data.totalItems === 0) return;
                
                const book = data.items[0].volumeInfo;
                if (!book) return;

                let changed = false;

                if (!item.getField('title') && book.title) {
                    item.setField('title', book.title);
                    changed = true;
                }

                if (book.subtitle && (!item.getField('title') || !item.getField('title').includes(book.subtitle))) {
                    const fullTitle = book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
                    item.setField('title', fullTitle);
                    changed = true;
                }

                if (book.authors && book.authors.length > 0) {
                    const currentAuthors = item.getCreators();
                    if (currentAuthors.length === 0) {
                        book.authors.forEach(author => {
                            // Tenta separar nome e sobrenome
                            const nameParts = author.split(' ');
                            const lastName = nameParts.pop() || '';
                            const firstName = nameParts.join(' ') || '';
                            
                            item.addCreator({
                                firstName: firstName,
                                lastName: lastName,
                                creatorType: 'author'
                            });
                        });
                        changed = true;
                    }
                }

                if (!item.getField('publisher') && book.publisher) {
                    item.setField('publisher', book.publisher);
                    changed = true;
                }

                if (!item.getField('date') && book.publishedDate) {
                    item.setField('date', book.publishedDate);
                    changed = true;
                }

                if (!item.getField('abstractNote') && book.description) {
                    const cleanDescription = book.description.replace(/<[^>]*>/g, '');
                    item.setField('abstractNote', cleanDescription);
                    changed = true;
                }

                if (!item.getField('numPages') && book.pageCount) {
                    item.setField('numPages', book.pageCount.toString());
                    changed = true;
                }

                if (!item.getField('language') && book.language) {
                    item.setField('language', book.language.toUpperCase());
                    changed = true;
                }

                if (book.categories && book.categories.length > 0) {
                    book.categories.forEach(category => {
                        if (!item.hasTag(category)) {
                            item.addTag(category);
                            changed = true;
                        }
                    });
                }

                if (book.industryIdentifiers) {
                    const isbn13 = book.industryIdentifiers.find(id => id.type === 'ISBN_13');
                    const isbn10 = book.industryIdentifiers.find(id => id.type === 'ISBN_10');
                    
                    const bestISBN = (isbn13 || isbn10)?.identifier;
                    if (bestISBN && bestISBN !== isbn) {
                        item.setField('ISBN', bestISBN);
                        changed = true;
                    }
                }

                if (book.imageLinks && book.imageLinks.thumbnail) {
                    let extra = item.getField('extra') || '';
                    if (!extra.includes('thumbnail:')) {
                        item.setField('extra', extra + (extra ? "\n" : "") + `thumbnail: ${book.imageLinks.thumbnail}`);
                        changed = true;
                    }
                }

                if (book.infoLink) {
                    let extra = item.getField('extra') || '';
                    if (!extra.includes('Google Books:')) {
                        item.setField('extra', extra + (extra ? "\n" : "") + `Google Books: ${book.infoLink}`);
                        changed = true;
                    }
                }

                if (book.series || book.volume) {
                    let extra = item.getField('extra') || '';
                    const seriesInfo = [];
                    if (book.series) seriesInfo.push(`Série: ${book.series}`);
                    if (book.volume) seriesInfo.push(`Volume: ${book.volume}`);
                    
                    const seriesText = seriesInfo.join('; ');
                    if (seriesText && !extra.includes('Série:')) {
                        item.setField('extra', extra + (extra ? "\n" : "") + seriesText);
                        changed = true;
                    }
                }

                if (changed) {
                    await item.saveTx();
                    updatedCount++;
                }
            } catch (err) {
                console.error(`Erro no processamento do ISBN ${isbn}:`, err);
            }
        }));
    }
})();
```
