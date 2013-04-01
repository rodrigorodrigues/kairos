/* global _: false */
(function (exports, _, KairosTimeFrame, privateKey) {

  function logChannelFactory (channel) {
    // Have to do some fancy shit here since all the console methods are native,
    // you can't use apply on them in all browsers and you can't alias them in
    // all browsers.
    return function (text, args) {
      if (exports.console && console[channel]) { // Allow late binding, e.g. Firebug
        args = [].splice.call(arguments, 1);
        if (0 === args.length) { // Handle the simple use-case first, to avoid the possibility of an error, and the associated overhead
          console[channel](text);
        } else {
          try { // This part is in a try-catch since in several browsers, you're not allowed to use apply on a native method
            console[channel].apply(null, [].splice.call(arguments, 0));
          } catch (e) { // In those cases, just dump the args
            console[channel](text, args);
          }
        }
      }
    };
  }

  /**
   * Wires up began/ended/ticked/muted/unmuted proxy subscriptions for a frame.
   *
   * @private
   * @method  wireupSubscriptions
   *
   * @param   {KairosTimeFrame} frame
   */
  function wireupSubscriptions (frame) {
    var self = this;

    frame.subscribe('began', function (f) {
      self.publish('timeFrameBegan', [f]);
      if (f.getName()) {
        self.publish(f.getName() + '/began', [f]);
      }
    });

    frame.subscribe('ended', function (f) {
      self.publish('timeFrameEnded', [f]);
      if (f.getName()) {
        self.publish(f.getName() + '/ended', [f]);
      }
    });

    frame.subscribe('ticked', function (f) {
      self.publish('timeFrameTicked', [f]);
      if (f.getName()) {
        self.publish(f.getName() + '/ticked', [f]);
      }
    });

    frame.subscribe('muted', function (f) {
      self.publish('timeFrameMuted', [f]);
      if (f.getName()) {
        self.publish(f.getName() + '/muted', [f]);
      }
    });

    frame.subscribe('unmuted', function (f) {
      self.publish('timeFrameUnmuted', [f]);
      if (f.getName()) {
        self.publish(f.getName() + '/unmuted', [f]);
      }
    });
  }

  /**
   * Creates a collection of time frames.
   *
   * @public
   * @constructor KairosCollection
   * @constructor
   *
   * @param {KairosTimeFrame[]|Object[]} frames
   *
   * @throws {DuplicateError}
   *
   * @usage:
   *   myCollection = new KairosCollection([
   *     new KairosTimeFrame('foo'),
   *     new KairosTimeFrame({
   *       beginsAt: 'now'
   *     }),
   *     {
   *       beginsAt: 'epoch'
   *     }
   *   ]).start()
   */
  function KairosCollection (frames) {
    this.logger.info('Creating a new Kairos Collection');

    var
      privateData = {
        frames: _.map(frames, function (frame) {
          if (frame instanceof KairosTimeFrame) {
            return frame;
          } else {
            return new KairosTimeFrame(frame);
          }
        }),
        notifyChannels: {}
      },
      names = _.compact(_.invoke(privateData.frames, 'getName'));

    if (names.length !== _.unique(names).length) {
      throw new exports.DuplicateError('Duplicate names found');
    }

    _.each(privateData.frames, _.bind(wireupSubscriptions, this));

    /**
     * Our private data needs to be accessible from our prototypes, but not be
     * accessible otherwise. We accomplish this using a lock & key
     *
     * @private
     * @method  _private
     *
     * @param   {String} key
     *
     * @return  {Object}
     *
     * @throws  AccessDenied
     */
    this._private = function (key) {
      if (key === privateKey) {
        return privateData;
      }
      throw new exports.AccessDenied();
    };
  }

  _.extend(KairosCollection.prototype, {
    /**
     * Starts each frame
     *
     * @public
     * @method start
     *
     * @return {KairosCollection}
     */
    start: function () {
      _.invoke(this._private(privateKey).frames, 'start');

      return this;
    },

    /**
     * Stops each frame
     *
     * @public
     * @method stop
     *
     * @return {KairosCollection}
     */
    stop: function () {
      _.invoke(this._private(privateKey).frames, 'stop');

      return this;
    },

    /**
     * Mutes each frame
     *
     * @public
     * @method mute
     *
     * @return {KairosCollection}
     */
    mute: function () {
      _.invoke(this._private(privateKey).frames, 'mute');

      return this;
    },

    /**
     * Unmutes each frame
     *
     * @public
     * @method unmute
     *
     * @return {KairosCollection}
     */
    unmute: function () {
      _.invoke(this._private(privateKey).frames, 'unmute');

      return this;
    },

    /**
     * Subscribes a function to a given channel.
     *
     * @public
     * @method subscribe
     *
     * @param  {String}   channel
     * @param  {Function} fn
     *
     * @return {KairosCollection}
     *
     * @usage:
     *   myCollection.subscribe('foo', function (bar) { ... }
     */
    subscribe: function (channel, fn) {
      var notifyChannels = this._private(privateKey).notifyChannels;

      if (!notifyChannels[channel]) {
        notifyChannels[channel] = [];
      }
      notifyChannels[channel].push(fn);

      return this;
    },

    /**
     * Publishes an event on a given channel.
     *
     * @public
     * @method publish
     *
     * @param  {String} channel
     * @param  {Mixed}  [args]
     * @param  {Object} [scope]
     *
     * @return {KairosCollection}
     *
     * @usage:
     *   myCollection.publish('foo', bar);
     */
    publish: function (channel, args, scope) {
      var
        self = this,
        notifyChannels = this._private(privateKey).notifyChannels;

      if (notifyChannels[channel]) {
        if (!_.isArray(args)) {
          args = [args];
        }

        _.each(notifyChannels[channel], function (fn) {
          try {
            fn.apply(scope, args);
          } catch (e) {
            self.logger.error(e);
          }
        });
      }

      return this;
    },

    /**
     * Unsubscribes a function from a given channel.
     *
     * @public
     * @method unsubscribe
     *
     * @param  {Mixed} handle
     *
     * @return {KairosCollection}
     *
     * @usage:
     *   myCollection.unsubscribe(['foo', fooFn])
     */
    unsubscribe: function (handle) {
      var
        notifyChannels = this._private(privateKey).notifyChannels,
        channel = handle[0],
        fn = handle[1],
        i;

      if (notifyChannels[channel]) {
        for (i = 0; i < notifyChannels[channel].length; i += 1) {
          if (notifyChannels[channel][i] === fn) {
            notifyChannels[channel].splice(i, 1);
          }
        }
      }

      return this;
    },

    /**
     * Returns a representation of this collection suitable for json serialization.
     *
     * @public
     * @method toJSON
     *
     * @alias toJson
     *
     * @todo
     *
     * @return {Object}
     */
    toJSON: function () {
      return {};
    }, // TODO

    /**
     * Returns a string representation of this time frame.
     *
     * @public
     * @method toString
     *
     * @return {String}
     */
    toString: function () {
      return JSON.stringify(this.toJson(), null, 2);
    },

    logger: {
      log:   logChannelFactory('log'),
      info:  logChannelFactory('info'),
      debug: logChannelFactory('debug'),
      warn:  logChannelFactory('warn'),
      error: logChannelFactory('error')
    },

    /**
     * Extends the set of named times in each frame.
     *
     * @public
     * @method extendNamedTimes
     *
     * @param  {Object} obj
     *
     * @return {KairosCollection}
     *
     * @throws {MissingParameter|ImmutableError}
     *
     * @usage:
     *   myCollection.extendNamedTimes({
     *     foo: new Date('1234-05-06')
     *   })
     */
    extendNamedTimes: function (obj) {
      _.invoke(this._private(privateKey).frames, 'extendNamedTimes', obj);

      return this;
    },

    /**
     * Adds a time frame to the collection
     *
     * @public
     * @method pushTimeFrame
     *
     * @param  {KairosTimeFrame|Object} frame
     *
     * @return {KairosCollection}
     *
     * @usage:
     *   myCollection.pushTimeFrame(new KairosTimeFrame())
     *   myCollection.pushTimeFrame({
     *     beginsAt: 'noon'
     *     })
     */
    pushTimeFrame: function (frame) {
      if (!(frame instanceof KairosTimeFrame)) {
        frame = new KairosTimeFrame(frame);
      }

      this.logger.info('Adding new Time Frame', frame);

      this._private(privateKey).frames.push(frame);

      wireupSubscriptions.call(this, frame);

      return this;
    },

    /**
     * Gets all of the time frames
     *
     * @public
     * @method getTimeFrames
     * @getter
     *
     * @return {KairosTimeFrame[]}
     */
    getTimeFrames: function () {
      return _.clone(this._private(privateKey).frames);
    },

    /**
     * Find a single time frame by name
     *
     * @public
     * @method getNamedTimeFrame
     *
     * @param  {String} name
     *
     * @return {KairosTimeFrame}
     *
     * @throws {MissingParameter}
     */
    getNamedTimeFrame: function (name) {
      if (!name) {
        throw new exports.MissingParameter('No name was provided');
      } else {
        return _.find(this._private(privateKey).frames, function (frame) {
          return frame.getName() === name;
        });
      }
    },

    version: '0.3.0' // TODO: ALWAYS REMEMBER TO UPDATE THIS
                     // TODO #2: Automate this
  });

  KairosCollection.prototype.toJson = KairosCollection.prototype.toJSON;

  KairosCollection.version = '0.3.0'; // TODO: ALWAYS REMEMBER TO UPDATE THIS

  exports.KairosCollection = KairosCollection;

}(
  'object' === typeof exports && exports || this,
  'object' === typeof exports && (require && require('underscore')) || this._ || _,
  'object' === typeof exports && exports.KairosTimeFrame || this.KairosTimeFrame,
  Math.floor(Math.random() * 10000000 + 10000000).toString(36)
));