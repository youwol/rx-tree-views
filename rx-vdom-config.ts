type AllTags = keyof HTMLElementTagNameMap
export type Configuration = {
    TypeCheck: 'strict'
    SupportedHTMLTags: 'Dev' extends 'Prod' ? AllTags : DevTags
    WithFluxView: false
}

type DevTags = 'div' | 'i'
