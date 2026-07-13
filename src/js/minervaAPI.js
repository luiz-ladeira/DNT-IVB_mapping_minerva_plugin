/**
 * Definitions of minerva plugin API.
 */


/**
 * @typedef {Object} MinervaApiUrls
 * @property {string} baseApiUrl
 * @property {string} baseNewApiUrl
 *
 */

/**
 * @typedef {Object} MinervaProjectData
 * @property {function} getProjectId
 * @property {function():MinervaApiUrls} getApiUrls
 *
 */

/**
 * @typedef {Object} MinervaProject
 * @property {data} MinervaProjectData
 *
 */

/**
 * @typedef {Object} MinervaMap
 * @property {function({x1:number, y1:number, x2:number, y2:number})} fitBounds
 * @property {function({id:number})} openMap
 */

/**
 * @typedef {Object} MinervaPluginRegisterData
 * @property {string} pluginName
 * @property {string} pluginVersion
 * @property {string} pluginUrl
 *
 */

/**
 * @typedef {Object} MinervaPluginResultData
 * @property {HTMLDivElement} element
 * @property {Object} events
 * @property {function} events.addListener
 * @property {function} events.removeListener
 * @property {function} events.removeAllListeners
 *
 */

/**
 * @typedef {Object} MinervaPlugin
 * @property {function(MinervaPluginRegisterData):MinervaPluginResultData} registerPlugin
 *
 */

/**
 * @typedef {Object} MarkerData
 * @property {"pin"|"surface"} type
 * @property {string} [id]
 * @property {string} color
 * @property {number} opacity
 * @property {number} x
 * @property {number} y
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [number]
 * @property {number} [modelId]
 *
 */

/**
 * @typedef {Object} MinervaData
 * @property {Object} bioEntities
 * @property {function} bioEntities.removeSingleMarker
 * @property {function({MarkerData})} bioEntities.addSingleMarker
 * @property {function} bioEntities.removeAllMarkers
 *
 */

/**
 * @typedef {Object} MinervaAPI
 * @property {MinervaPlugin} plugins
 * @property {MinervaProject} project
 * @property {MinervaMap} map
 * @property {MinervaData} data
 */


/**
 * @typedef {Object} MinervaElement
 * @property {number} id
 * @property {number} modelId
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} MinervaSegment
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * @typedef {Object} MinervaReactant
 * @property {MinervaSegment[]} line.segments
 */
/**
 * @typedef {Object} MinervaOperator
 * @property {MinervaSegment[]} line.segments
 */
/**
 * @typedef {Object} MinervaModifier
 * @property {MinervaSegment[]} line.segments
 */
/**
 * @typedef {Object} MinervaProduct
 * @property {MinervaSegment[]} line.segments
 */

/**
 * @typedef {Object} MinervaReaction
 * @property {number} id
 * @property {number} modelId
 * @property {string} idReaction
 * @property {MinervaSegment[]} line.segments
 * @property {MinervaOperator[]} operators
 * @property {MinervaReactant[]} reactants
 * @property {MinervaProduct[]} products
 * @property {MinervaModifier[]} modifiers
 *
 */


/**
 * @typedef {Object} MinervaElementId
 * @property {number} id
 * @property {number} modelId
 * @property {("ALIAS"|"REACTION")} type
 */

/**
 * @typedef {Object} MinervaSearchResult
 * @property {Object} bioEntity
 * @property {boolean} perfect
 *
 */

/**
 * @typedef {Object} MinervaSearchListenerData
 * @property {("bioEntity"|"drugs"|"chemicals")} type
 * @property {Object[]} searchValues
 * @property {MinervaSearchResult[]} results
 *
 */