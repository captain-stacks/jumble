import { createContext, useContext } from 'react'

const PostFromContext = createContext<string[] | undefined>(undefined)

export const usePostFrom = () => useContext(PostFromContext)

export const PostFromProvider = PostFromContext.Provider
