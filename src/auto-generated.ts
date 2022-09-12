
const runTimeDependencies = {
    "load": {
        "rxjs": "^6.5.5",
        "@youwol/flux-view": "^1.0.0"
    },
    "differed": {},
    "includedInBundle": []
}
const externals = {
    "rxjs": "rxjs_APIv6",
    "@youwol/flux-view": "@youwol/flux-view_APIv1",
    "rxjs/operators": {
        "commonjs": "rxjs/operators",
        "commonjs2": "rxjs/operators",
        "root": [
            "rxjs_APIv6",
            "operators"
        ]
    }
}
export const setup = {
    name:'@youwol/fv-tree',
    assetId:'QHlvdXdvbC9mdi10cmVl',
    version:'0.2.0',
    shortDescription:"Tree views using flux-view.",
    developerDocumentation:'https://platform.youwol.com/applications/@youwol/cdn-explorer/latest?package=@youwol/fv-tree',
    npmPackage:'https://www.npmjs.com/package/@youwol/fv-tree',
    sourceGithub:'https://github.com/youwol/fv-tree',
    userGuide:'https://l.youwol.com/doc/@youwol/fv-tree',
    apiVersion:'02',
    runTimeDependencies,
    externals
}
