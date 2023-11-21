var Select

class ThemeItemData extends Select.ItemData {
    constructor(id, name) {
        super(id, name)
        //this.urlBase = '../../../../fv-widgets/assets/styles/'
        this.urlBase = `https://unpkg.com/@youwol/fv-widgets@0.0.1/assets/styles/`
    }

    link() {
        let link = document.createElement('link')
        Object.assign(link, {
            id: 'theme-css',
            rel: 'stylesheet',
            href: this.urlBase + `style.${this.id}.css`,
        })
        return link
    }
}
let itemsCss = [
    new ThemeItemData('youwol', 'YouWol'),
    new ThemeItemData('gg-default', 'Google Default'),
    new ThemeItemData('gg-dark', 'Google Dark'),
]
let stateCss = new Select.State(itemsCss, 'youwol')

let sub = stateCss.selection$.subscribe((themeItem) => {
    if (document.getElementById('theme-css')) {
        document.getElementById('theme-css').remove()
    }
    document.head.appendChild(themeItem.link())
})

export const vDomThemes = {
    class: 'd-flex fv-text-focus justify-content-center',
    children: [
        { class: 'px-2', innerText: 'Current theme' },
        new Select.View({ state: stateCss }),
    ],
    connectedCallback: (elem) => {
        elem.subscriptions.push(sub)
    },
}
