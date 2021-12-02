<h1 align="center">fv-tree 👋</h1>

<p>
    <img alt="Version" src="https://img.shields.io/badge/version-0.0.0-blue.svg?cacheSeconds=2592000" />
    <a href="https://github.com/kefranabg/readme-md-generator/graphs/commit-activity" target="_blank">
        <img alt="Maintenance" src="https://img.shields.io/badge/Maintained%3F-yes-green.svg" />
    </a>
    <a href="https://github.com/kefranabg/readme-md-generator/blob/master/LICENSE" target="_blank">
        <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
    </a>
</p>

>

## What is it?

Tree widgets created using <a href="https://github.com/youwol/flux-view">flux-view</a>.
For now, only an ImmutableTree is exposed (the case of a mutable one will come soon).

### ImmutableTree

Modification of the tree do not modify nodes: when an edit happens only the portions of the tree that were affected by the edit is rebuild (which is typically about O(log n) of the total nodes in the tree).

Some examples are provided in code sandbox:

-   <a href='https://codesandbox.io/s/github/youwol/fv-tree/blob/master/src/demos/showcase-basic?file=/index.html'>Basic example</a> : shows how to contruct and display a tree view from JSON data. A context menu is also constructed

-   <a href='https://codesandbox.io/s/github/youwol/fv-tree/blob/master/src/demos/showcase-async?file=/index.html'>Async example</a> : shows how to contruct and display a tree view using async data. The user can pick a directory of his local
    file-system and displays the structure in the tree view.
    **NOTE**: This example is actually not working for now in code sandbox
    as opening a directory picker from a sub-frame seems forbidden. You can download (or copy-paste) this
    <a href='https://github.com/youwol/fv-tree/blob/master/src/demos/showcase-async/index.html'> file </a> and open it in
    your browser to make it work.

-   <a href='https://codesandbox.io/s/github/youwol/fv-tree/blob/master/src/demos/showcase-edit?file=/index.html'>Edit example</a> : shows how to apply live edits on a tree view. It also demonstrate undo/redo capabilities and the immutability
    of the nodes.
