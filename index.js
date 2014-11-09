var Promise = require('bluebird'),
  Waterline = require('waterline'),
  _ = require('lodash'),
  util = require('../../system/core/util')


var diskAdapter = require('sails-disk')
//var mongoAdapter = require('sails-mongo')


function extendListener(module) {
  //TODO listen model:action
  module.listen = {}

  _.forEach( module.models, function( model, name){

    ['find', 'create', 'update', 'destroy','findOne',"findOrCreate"].forEach(function (method) {

      module.listen[ name+'.'+method] ={
        "name" : method + "." + name,
        "function": function () {
          module.dep.logger.log("on", name, method )
          //this bus is a started forked bus or snapshot
          var bus = this,
            args = _.toArray(arguments)


          //we should use cloned orm model function, so inside the function we can trigger lifecycle callbacks
          var model = module.models[name]
          return bus.fapply([name+"."+method].concat( args ), function(){

            var result = callModelMethod(model, method, args).then(function( modelResult){
              return modelResult
            })
            result.catch(function(e){
              return bus.error(e)
            })

            //don't return result.catch(), this may mess up error catch outside
            return result
          })

          function callModelMethod(model, method, args){
            var where = _.omit(args[0],"populate")
            if( /^find/.test(method) && model.relations){
              _.forEach( model.relations, function( relationDef, relationName){
                where = _.omit(where,relationName)
              })
            }

            var replacedArgs = [where].concat(args.slice(1))
            return model[method].apply(model, replacedArgs)
          }
        }
      }
    })
  })
}


/**
 * 为所有定义了 models 属性的模块提供 orm 服务。
 * @module model
 */
module.exports = {
  deps : ['bus'],
  orm: new Waterline,
  config : {
    adapters: {
      "default": diskAdapter,
      disk: diskAdapter,
      //mongo : mongoAdapter
    },
    connections: {
      localDisk: {
        adapter: 'disk'
      },
      //mongo : {
      //  adapter : 'mongo'
      //}
    },
    defaults: {
      migrate: 'alter'
    }
  },
  models : {},
  /**
   * 如果模块定义了 models 属性，则读取其中的每个 model 定义，并通过 waterline 来建立 orm 。
   * 所有建立的 model 对象都将存在此模块的 models 属性中，可以直接调用。
   * 也可以通过例如 `bus.fire("model.find")` 的方式来调用，推荐使用这种方式。
   * @param module
   */
  expand: function (module) {
    var root = this
    if (!module.models) return

    _.forEach(module.models,function (model, identity) {
      if(!_.isArray( module.models)){
        model.identity = identity
      }
      //add model placeholder here, so other modules may know what models are registered
      if( !root.models[model.identity]){
        root.models[model.identity] = _.defaults(model,{
          migrate : 'safe',
          connection : 'localDisk'
        })
      }else if( model.alter ){
        root.models[model.identity] = util.mergeDeep( root.models[model.identity],model )
      }else{
        root.dep.logger.warn("duplicated model definition :",model.identity,"from",root.name)
      }
    })
  },
  bootstrap: function () {
    var root = this

    _.forEach(root.models,function(model){
      root.orm.loadCollection(Waterline.Collection.extend(model))
    })

    return new Promise(function (resolve, reject) {
      root.orm.initialize(root.config, function (err, models){
        if (err) return reject( err);

        _.forEach( root.models ,function( m,name){
          root.models[name] = _.defaults(models.collections[name],m )
        })
        root.connections = models.connections;


        //add listen to this module
        //manually use module bus to add listeners
        extendListener(root)
        root.dep.bus.expand(root)
        resolve()
      });
    })
  }
}