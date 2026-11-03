import { appContainer } from '../app/appContainer'

/** HTTP fixture for existing app flow tests; production still uses the Core API. */
export const worldStudioFetch:typeof fetch=async (url) => {
 const worlds=await appContainer.resolve('worldRepository').list()
 const rows=worlds.filter(w=>!w.owner).map(w=>({id:w.id,name:w.name,description:w.description,version:1,settings:[],analysis:null}))
 const path=String(url)
 const data=path.endsWith('/capabilities')?{aiEnabled:false}:path.endsWith('/worlds')?rows:rows.find(w=>path.endsWith('/'+w.id))??{}
 return new Response(JSON.stringify(data))
}
